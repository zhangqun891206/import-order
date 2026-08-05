import { db } from "../db";
import { trace, perfLog } from "./trace";
import { newEventId, unitId, ERR, SUGGESTION, maskSensitive, now } from "./util";
import { normalizeExcel } from "../ir/excel";
import { normalizeWordServer } from "../ir/word-server";
import { normalizePdf } from "../ir/pdf";
import { executeRule } from "../engine/executor";
import { getRule } from "../db/rules";
import type { ItemRow } from "../engine/types";
import type { NormalizedDocument } from "../ir/types";

const BATCH_SIZE = 1000;
const PHONE_RE = /^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|400-?\d{3}-?\d{4})$/;

interface TaskRow {
  id: string;
  trace_id: string | null;
  rule_id: number | null;
  file_name: string | null;
  file_bytes: string | null;
  status: string;
  degraded: boolean;
}
interface BatchRow {
  id: number;
  task_id: string;
  unit_id: string;
  batch_index: number;
  kind: string;
  start_row: number | null;
  end_row: number | null;
  status: string;
  retry_count: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

// ================= Outbox 投递（Dispatcher） =================
async function dispatchOutbox(): Promise<number> {
  const due = (await db.query(
    `SELECT id, event_type, payload, trace_id, aggregate_id FROM event_outbox
     WHERE status='pending' AND next_retry_at <= now()
     ORDER BY created_at LIMIT 50`,
    []
  )) as { id: string; event_type: string; trace_id: string | null }[];
  for (const e of due) {
    try {
      // 投递 = 标记 sent（DB 队列：批次工作单元已在 import_task_batches，供 Worker 认领）
      await db.query(`UPDATE event_outbox SET status='sent', sent_at=now() WHERE id=$1`, [e.id]);
    } catch {
      await db.query(`UPDATE event_outbox SET retry_count=retry_count+1, status=CASE WHEN retry_count>=5 THEN 'failed' ELSE 'pending' END, next_retry_at=now()+interval '5 seconds' WHERE id=$1`, [e.id])
        .catch(() => {});
    }
  }
  return due.length;
}

// ================= 认领处理单元 =================
async function claimUnit(): Promise<BatchRow | null> {
  const rows = (await db.query(
    `UPDATE import_task_batches SET status='processing', locked_at=now()
     WHERE id = (
       SELECT id FROM import_task_batches
       WHERE status='pending' OR (status='processing' AND locked_at < now() - interval '90 seconds')
       ORDER BY (kind='parse') DESC, batch_index
       FOR UPDATE SKIP LOCKED LIMIT 1
     ) RETURNING *`,
    []
  )) as BatchRow[];
  return rows[0] || null;
}

// ================= 解析单元 =================
async function processParseUnit(task: TaskRow, unit: BatchRow): Promise<void> {
  const t0 = now();
  const traceId = task.trace_id || "";
  await trace({ traceId, taskId: task.id, unitId: unit.unit_id, event: "ImportBatchStarted", message: "解析单元开始" });

  if (!task.file_bytes) {
    // 文件字节由上传后台落库，尚未就绪：释放回 pending，不消耗重试
    await db.query(`UPDATE import_task_batches SET status='pending', locked_at=NULL WHERE id=$1`, [unit.id]);
    return;
  }
  const buf = Buffer.from(task.file_bytes, "base64");
  const name = task.file_name || "";

  const parseT = now();
  let doc: NormalizedDocument;
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) doc = normalizeExcel(new Uint8Array(buf), name);
  else if (lower.endsWith(".docx")) doc = await normalizeWordServer(buf, name);
  else if (lower.endsWith(".pdf")) doc = await normalizePdf(buf, name);
  else throw new Error(ERR.E008);
  const parseMs = now() - parseT;

  const ruleT = now();
  const rule = task.rule_id != null ? await getRule(task.rule_id) : null;
  if (!rule) throw new Error(ERR.E006);
  const result = executeRule(doc, rule);
  const ruleMs = now() - ruleT;

  const rows = result.rows;
  // 行暂存（分片并发 INSERT，减少高延迟网络往返）
  const insT = now();
  const insertPromises: Promise<unknown>[] = [];
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const vals: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const base = i + j + 1;
      params.push(task.id, base, r.externalCode || null, r.store || null, r.receiverName || null, r.receiverPhone || null, r.receiverAddress || null, r.skuCode || null, r.skuName || null, toNum(r.skuQty), r.skuSpec || null, r.remark || null);
      const o = params.length - 11;
      vals.push(`($${o},$${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11})`);
    });
    insertPromises.push(db.query(
      `INSERT INTO import_task_rows (task_id,row_number,external_code,store,receiver_name,receiver_phone,receiver_address,sku_code,sku_name,sku_qty,sku_spec,remark)
       VALUES ${vals.join(",")} ON CONFLICT (task_id,row_number) DO NOTHING`,
      params as never[]
    ));
  }
  await Promise.all(insertPromises);

  // 创建批次单元 + Outbox 事件
  const totalBatches = Math.max(1, Math.ceil(rows.length / BATCH_SIZE));
  const bVals: string[] = [];
  const bParams: unknown[] = [];
  const oVals: string[] = [];
  const oParams: unknown[] = [];
  for (let b = 1; b <= totalBatches; b++) {
    const start = (b - 1) * BATCH_SIZE + 1;
    const end = Math.min(b * BATCH_SIZE, rows.length);
    bParams.push(task.id, unitId(b), b, "batch", start, end, end - start + 1);
    const bo = bParams.length - 6;
    bVals.push(`($${bo},$${bo + 1},$${bo + 2},$${bo + 3},$${bo + 4},$${bo + 5},$${bo + 6})`);
    oParams.push(newEventId(), task.id, "ImportBatchCreated", 1, JSON.stringify({ task_id: task.id, unit_id: unitId(b), start_row: start, end_row: end }), traceId);
    const oo = oParams.length - 5;
    oVals.push(`($${oo},$${oo + 1},$${oo + 2},$${oo + 3},$${oo + 4}::jsonb,$${oo + 5})`);
  }
  await Promise.all([
    db.query(
      `INSERT INTO import_task_batches (task_id,unit_id,batch_index,kind,start_row,end_row,rows_total) VALUES ${bVals.join(",")} ON CONFLICT (task_id,unit_id) DO NOTHING`,
      bParams as never[]
    ),
    db.query(
      `INSERT INTO event_outbox (id,aggregate_id,event_type,schema_version,payload,trace_id) VALUES ${oVals.join(",")} ON CONFLICT (id) DO NOTHING`,
      oParams as never[]
    ),
  ]);

  await Promise.all([
    db.query(`UPDATE import_tasks SET total_rows=$1, total_batches=$2, status='processing' WHERE id=$3`, [rows.length, totalBatches, task.id]),
    db.query(`UPDATE import_task_batches SET status='done', rows_total=$1, rows_ok=$1, completed_at=now() WHERE id=$2`, [rows.length, unit.id]),
  ]);

  const totalMs = now() - t0;
  await perfLog({ taskId: task.id, unitId: unit.unit_id, batchIndex: 0, parseMs, ruleMs, insertMs: now() - insT, totalMs, status: "ok", traceId });
  await trace({ traceId, taskId: task.id, unitId: unit.unit_id, event: "ImportBatchSucceeded", message: `解析完成 ${rows.length} 行 / ${totalBatches} 批` });
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

// ================= 批次单元 =================
async function processBatchUnit(task: TaskRow, unit: BatchRow): Promise<void> {
  const t0 = now();
  const traceId = task.trace_id || "";
  await trace({ traceId, taskId: task.id, unitId: unit.unit_id, event: "ImportBatchStarted", message: `批次 ${unit.batch_index} 开始` });

  const rows = (await db.query(
    `SELECT * FROM import_task_rows WHERE task_id=$1 AND row_number BETWEEN $2 AND $3 ORDER BY row_number`,
    [task.id, unit.start_row, unit.end_row]
  )) as Record<string, unknown>[];

  // ---- 校验 ----
  const vT = now();
  const errors: { row: number; field: string; raw: string; code: keyof typeof ERR; }[] = [];
  const okRows: Record<string, unknown>[] = [];

  const skuCodes = Array.from(new Set(rows.map((r) => String(r.sku_code || "")).filter(Boolean)));
  const extCodes = Array.from(new Set(rows.map((r) => String(r.external_code || "")).filter(Boolean)));

  // 并行：清旧错误 + SKU 批量校验(3s 超时→降级) + 外部编码重复检测（减少高延迟网络往返轮数）
  let degraded = false;
  const [, skuGot, dupGot] = await Promise.all([
    db.query(`DELETE FROM import_task_errors WHERE task_id=$1 AND unit_id=$2`, [task.id, unit.unit_id]),
    skuCodes.length
      ? withTimeout(db.query(`SELECT sku_code FROM sku_master WHERE sku_code = ANY($1)`, [skuCodes]), 3000).catch(() => { degraded = true; return []; })
      : Promise.resolve([]),
    extCodes.length
      ? db.query(
          `SELECT external_code, sku_code, MIN(row_number) AS min_row FROM import_task_rows
           WHERE task_id=$1 AND external_code = ANY($2) GROUP BY external_code, sku_code HAVING COUNT(*)>1`,
          [task.id, extCodes]
        )
      : Promise.resolve([]),
  ]);
  const skuSet = new Set((skuGot as { sku_code: string }[]).map((g) => g.sku_code));
  const dupMin = new Map((dupGot as { external_code: string; sku_code: string; min_row: number }[]).map((d) => [`${d.external_code}|${d.sku_code}`, d.min_row]));

  for (const r of rows) {
    const rowNo = Number(r.row_number);
    let rowOk = true;
    const fail = (field: string, raw: unknown, code: keyof typeof ERR) => {
      rowOk = false;
      errors.push({ row: rowNo, field, raw: String(raw ?? ""), code });
    };
    const skuCode = String(r.sku_code || "");
    const skuName = String(r.sku_name || "");
    const qty = r.sku_qty == null ? null : Number(r.sku_qty);
    const phone = String(r.receiver_phone || "");
    const hasA = Boolean(r.store && String(r.store).trim());
    const hasB = Boolean(String(r.receiver_name || "").trim() && phone.trim() && String(r.receiver_address || "").trim());

    if (!skuCode || !skuName) fail(!skuCode ? "sku_code" : "sku_name", skuCode || skuName, "E002");
    if (qty == null || !(qty > 0)) fail("sku_qty", r.sku_qty, "E004");
    if (phone && !PHONE_RE.test(phone.trim())) fail("receiver_phone", phone, "E003");
    if (!hasA && !hasB) fail("receiver", "", "E002");
    if (!degraded && skuCode && !skuSet.has(skuCode)) fail("sku_code", skuCode, "E001");
    const dupKey = `${r.external_code || ""}|${skuCode}`;
    if (dupMin.has(dupKey) && rowNo > dupMin.get(dupKey)!) fail("external_code", r.external_code, "E005");

    if (rowOk) okRows.push(r);
  }
  const validateMs = now() - vT;

  // ---- 并行写入：错误明细 + 运单 UPSERT ----
  const iT = now();
  let errP: Promise<unknown> = Promise.resolve(null);
  if (errors.length) {
    const eVals: string[] = [];
    const eParams: unknown[] = [];
    for (const e of errors) {
      eParams.push(task.id, unit.unit_id, unit.batch_index, e.row, e.field, maskSensitive(e.field, e.raw), e.code, ERR[e.code], SUGGESTION[e.code], traceId);
      const o = eParams.length - 9;
      eVals.push(`($${o},$${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`);
    }
    errP = db.query(
      `INSERT INTO import_task_errors (task_id,unit_id,batch_index,row_number,field_name,raw_value,error_code,error_reason,suggestion,trace_id) VALUES ${eVals.join(",")}`,
      eParams as never[]
    );
  }

  let upsertP: Promise<{ id: number; dedup_key: string }[]> = Promise.resolve([]);
  if (okRows.length) {
    const wVals: string[] = [];
    const wParams: unknown[] = [];
    for (const r of okRows) {
      const dedup = `${r.external_code || ""}|${r.sku_code || ""}|${r.row_number}`;
      const mode = r.store && String(r.store).trim() ? "A" : "B";
      wParams.push(r.external_code || null, mode, r.store || null, r.receiver_name || null, r.receiver_phone || null, r.receiver_address || null, r.remark || null, dedup);
      const o = wParams.length - 7;
      wVals.push(`(NULL,$${o},$${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7})`);
    }
    upsertP = db.query(
      `INSERT INTO waybills (batch_id, external_code, receiver_mode, store_name, receiver_name, receiver_phone, receiver_address, remark, dedup_key)
       VALUES ${wVals.join(",")}
       ON CONFLICT (dedup_key) DO UPDATE SET receiver_mode=EXCLUDED.receiver_mode, store_name=EXCLUDED.store_name, receiver_name=EXCLUDED.receiver_name,
         receiver_phone=EXCLUDED.receiver_phone, receiver_address=EXCLUDED.receiver_address, remark=EXCLUDED.remark
       RETURNING id, dedup_key`,
      wParams as never[]
    ) as unknown as Promise<{ id: number; dedup_key: string }[]>;
  }

  const [, inserted] = await Promise.all([errP, upsertP]);

  // 物品行：先清后插，保证重试幂等
  if (inserted.length) {
    const ids = inserted.map((i) => i.id);
    const idToRow = new Map(inserted.map((i) => [i.dedup_key, okRows.find((r) => `${r.external_code || ""}|${r.sku_code || ""}|${r.row_number}` === i.dedup_key)!]));
    const iVals: string[] = [];
    const iParams: unknown[] = [];
    for (const wb of inserted) {
      const r = idToRow.get(wb.dedup_key);
      if (!r) continue;
      iParams.push(wb.id, r.sku_code, r.sku_name, Number(r.sku_qty), r.sku_spec || null, r.remark || null);
      const o = iParams.length - 5;
      iVals.push(`($${o},$${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5})`);
    }
    await db.query(`DELETE FROM waybill_items WHERE waybill_id = ANY($1)`, [ids]);
    if (iVals.length) {
      await db.query(`INSERT INTO waybill_items (waybill_id,sku_code,sku_name,qty,spec,remark) VALUES ${iVals.join(",")}`, iParams as never[]);
    }
  }
  const insertMs = now() - iT;

  // ---- 更新批次 + 降级标记 ----
  await db.query(`UPDATE import_task_batches SET status='done', rows_total=$1, rows_ok=$2, rows_err=$3, completed_at=now() WHERE id=$4`, [rows.length, okRows.length, errors.length, unit.id]);
  if (degraded) {
    await db.query(`UPDATE import_tasks SET degraded=true, unverified_sku_rows=unverified_sku_rows+$1 WHERE id=$2`, [rows.length, task.id]);
    await trace({ traceId, taskId: task.id, unitId: unit.unit_id, event: "ImportTaskDegraded", status: "warn", message: "SKU 校验超时，已降级" });
  }

  const totalMs = now() - t0;
  await perfLog({ taskId: task.id, unitId: unit.unit_id, batchIndex: unit.batch_index, validateMs, insertMs, totalMs, status: "ok", traceId });
  await trace({ traceId, taskId: task.id, unitId: unit.unit_id, event: errors.length ? "ImportBatchSucceeded" : "ImportBatchSucceeded", message: `批次 ${unit.batch_index} 完成 ok=${okRows.length} err=${errors.length}` });

  await aggregateTask(task.id);
}

// ================= 任务状态聚合（原子重算，防重复累计） =================
async function aggregateTask(taskId: string): Promise<void> {
  const agg = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('done','failed')) AS completed,
            COALESCE(SUM(rows_total) FILTER (WHERE status='done'),0) AS processed,
            COALESCE(SUM(rows_ok) FILTER (WHERE status='done'),0) AS ok,
            COALESCE(SUM(rows_err) FILTER (WHERE status='done'),0) AS err,
            (SELECT COUNT(*) FROM import_task_batches b2 WHERE b2.task_id=$1 AND b2.kind='batch') AS total,
            (SELECT COUNT(*) FROM import_task_batches b3 WHERE b3.task_id=$1 AND b3.kind='batch' AND b3.status='failed') AS failed_units
     FROM import_task_batches WHERE task_id=$1 AND kind='batch'`,
    [taskId]
  )) as { completed: string; processed: string; ok: string; err: string; total: string; failed_units: string }[];
  const a = agg[0];
  const allDone = Number(a.completed) >= Number(a.total);
  let status: string | null = null;
  if (allDone) {
    const ok = Number(a.ok);
    const err = Number(a.err);
    const failedUnits = Number(a.failed_units);
    status = failedUnits === Number(a.total) ? "failed" : err === 0 ? "completed" : ok > 0 ? "partial_success" : "failed";
  }
  await db.query(
    `UPDATE import_tasks SET processed_rows=$1, success_rows=$2, failed_rows=$3, completed_batches=$4,
       status=COALESCE($5, status), completed_at=CASE WHEN $5 IS NOT NULL THEN now() ELSE completed_at END
     WHERE id=$6`,
    [Number(a.processed), Number(a.ok), Number(a.err), Number(a.completed), status, taskId]
  );
  if (status) {
    const t = (await db.query(`SELECT trace_id FROM import_tasks WHERE id=$1`, [taskId])) as { trace_id: string | null }[];
    await trace({ traceId: t[0]?.trace_id || "", taskId, event: status === "completed" ? "ImportTaskCompleted" : status === "partial_success" ? "ImportTaskPartialSuccess" : "ImportTaskFailed", message: `任务结束 ${status}` });
  }
}

// ================= 失败重试 =================
async function markFailed(unit: BatchRow, e: unknown): Promise<void> {
  const retry = unit.retry_count + 1;
  const maxRetry = 3;
  await db.query(
    `UPDATE import_task_batches SET retry_count=$1, status=$2, locked_at=NULL WHERE id=$3`,
    [retry, retry >= maxRetry ? "failed" : "pending", unit.id]
  );
  const task = (await db.query(`SELECT trace_id FROM import_tasks WHERE id=$1`, [unit.task_id])) as { trace_id: string | null }[];
  await trace({ traceId: task[0]?.trace_id || "", taskId: unit.task_id, unitId: unit.unit_id, event: "ImportBatchFailed", status: "error", message: `${e instanceof Error ? e.message : e}（retry ${retry}）` });
  if (retry >= maxRetry) await aggregateTask(unit.task_id);
}

// ================= 后台推进入口 =================
/** 响应返回后后台推进队列：优先 context.waitUntil（Vercel），否则 fire-and-forget（本地） */
export function kick(ctx: unknown, maxMs = 8000): void {
  const p = pump(maxMs).catch(() => {});
  const c = ctx as { waitUntil?: (promise: Promise<unknown>) => void } | undefined;
  if (c && typeof c.waitUntil === "function") {
    try {
      c.waitUntil(p);
      return;
    } catch {
      /* fallthrough */
    }
  }
  void p;
}

// ================= Pump（Dispatcher + Worker） =================
export async function pump(maxMs = 8000): Promise<{ processed: number }> {
  const deadline = now() + maxMs;
  let processed = 0;
  while (now() < deadline) {
    await dispatchOutbox();
    const unit = await claimUnit();
    if (!unit) break;
    const taskRows = (await db.query(`SELECT * FROM import_tasks WHERE id=$1`, [unit.task_id])) as TaskRow[];
    const task = taskRows[0];
    if (!task) {
      await db.query(`UPDATE import_task_batches SET status='failed' WHERE id=$1`, [unit.id]);
      continue;
    }
    try {
      if (unit.kind === "parse") await processParseUnit(task, unit);
      else await processBatchUnit(task, unit);
      processed++;
    } catch (e) {
      await markFailed(unit, e);
    }
  }
  return { processed };
}
