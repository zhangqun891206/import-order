import { sql } from "./index";
import type { SubmitOrderInput, WaybillQuery } from "../schemas";

/** 外部编码查重：返回数据库中已存在的编码集合 */
export async function findExistingExternalCodes(codes: string[]): Promise<Set<string>> {
  const valid = codes.filter((c) => c && c.trim());
  if (valid.length === 0) return new Set();
  const rows = (await sql()`
    SELECT DISTINCT external_code FROM waybills WHERE external_code = ANY(${valid})
  `) as unknown as { external_code: string }[];
  return new Set(rows.map((r) => r.external_code));
}

export interface SubmitResult {
  batchId: number;
  total: number;
  success: number;
  failed: number;
}

/** 提交下单：一个事务内写入批次 + 运单 + 物品行 */
export async function submitOrder(input: SubmitOrderInput): Promise<SubmitResult> {
  const client = sql();
  let success = 0;
  let failed = 0;

  // 创建批次
  const batchRows = (await client`
    INSERT INTO import_batches (file_name, rule_id, total_rows, success_rows, failed_rows)
    VALUES (${input.fileName || null}, ${input.ruleId || null}, ${input.waybills.length}, 0, 0)
    RETURNING id
  `) as unknown as { id: number }[];
  const batchId = batchRows[0].id;

  for (const wb of input.waybills) {
    try {
      const hasA = Boolean(wb.storeName && wb.storeName.trim());
      const mode = hasA ? "A" : "B";
      const wbRows = (await client`
        INSERT INTO waybills (batch_id, external_code, receiver_mode, store_name, receiver_name, receiver_phone, receiver_address, remark)
        VALUES (${batchId}, ${wb.externalCode || null}, ${mode}, ${wb.storeName || null},
                ${wb.receiverName || null}, ${wb.receiverPhone || null}, ${wb.receiverAddress || null}, ${wb.remark || null})
        RETURNING id
      `) as unknown as { id: number }[];
      const waybillId = wbRows[0].id;

      for (const it of wb.items) {
        const qty = typeof it.qty === "number" ? it.qty : parseFloat(String(it.qty));
        await client`
          INSERT INTO waybill_items (waybill_id, sku_code, sku_name, qty, spec, remark)
          VALUES (${waybillId}, ${it.skuCode}, ${it.skuName}, ${qty}, ${it.spec || null}, ${it.remark || null})
        `;
      }
      success++;
    } catch {
      failed++;
    }
  }

  await client`
    UPDATE import_batches SET success_rows = ${success}, failed_rows = ${failed} WHERE id = ${batchId}
  `;

  return { batchId, total: input.waybills.length, success, failed };
}

export interface WaybillListItem {
  id: number;
  externalCode: string | null;
  receiverMode: string;
  storeName: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  itemCount: number;
  createdAt: string;
}

export interface WaybillListResult {
  items: WaybillListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 运单列表：筛选 + 分页 */
export async function listWaybills(q: WaybillQuery): Promise<WaybillListResult> {
  const client = sql();
  const filters: string[] = [];
  const params: unknown[] = [];

  if (q.externalCode) {
    params.push(q.externalCode);
    filters.push(`w.external_code ILIKE '%' || $${params.length} || '%'`);
  }
  if (q.receiverName) {
    params.push(q.receiverName);
    filters.push(`(w.receiver_name ILIKE '%' || $${params.length} || '%' OR w.store_name ILIKE '%' || $${params.length} || '%')`);
  }
  if (q.startDate) {
    params.push(q.startDate);
    filters.push(`w.created_at >= $${params.length}::timestamptz`);
  }
  if (q.endDate) {
    params.push(q.endDate);
    filters.push(`w.created_at <= ($${params.length}::timestamptz + interval '1 day')`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (q.page - 1) * q.pageSize;

  const countRows = (await client.query(`SELECT COUNT(*)::int AS total FROM waybills w ${where}`, params as never[])) as unknown as {
    total: number;
  }[];
  const total = countRows[0]?.total ?? 0;

  const rows = (await client.query(
    `SELECT w.id, w.external_code, w.receiver_mode, w.store_name, w.receiver_name, w.receiver_phone, w.receiver_address, w.created_at,
            (SELECT COUNT(*)::int FROM waybill_items i WHERE i.waybill_id = w.id) AS item_count
     FROM waybills w ${where}
     ORDER BY w.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...(params as never[]), q.pageSize, offset]
  )) as unknown as {
    id: number;
    external_code: string | null;
    receiver_mode: string;
    store_name: string | null;
    receiver_name: string | null;
    receiver_phone: string | null;
    receiver_address: string | null;
    created_at: string;
    item_count: number;
  }[];

  return {
    items: rows.map((r) => ({
      id: r.id,
      externalCode: r.external_code,
      receiverMode: r.receiver_mode,
      storeName: r.store_name,
      receiverName: r.receiver_name,
      receiverPhone: r.receiver_phone,
      receiverAddress: r.receiver_address,
      itemCount: r.item_count,
      createdAt: r.created_at,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/** 单个运单明细（含物品行） */
export async function getWaybillDetail(id: number) {
  const client = sql();
  const wbRows = (await client`SELECT * FROM waybills WHERE id = ${id}`) as unknown as Record<string, unknown>[];
  if (!wbRows.length) return null;
  const itemRows = (await client`SELECT * FROM waybill_items WHERE waybill_id = ${id} ORDER BY id`) as unknown as Record<
    string,
    unknown
  >[];
  return { waybill: wbRows[0], items: itemRows };
}
