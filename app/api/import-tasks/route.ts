import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kick } from "@/lib/v4/worker";
import { newTaskId, newTraceId, newEventId, ERR } from "@/lib/v4/util";
import { trace } from "@/lib/v4/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function detectKind(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "excel";
  if (n.endsWith(".docx")) return "word";
  if (n.endsWith(".pdf")) return "pdf";
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const ruleIdRaw = form.get("ruleId");
    if (!file) return NextResponse.json({ ok: false, error: "缺少文件" }, { status: 400 });
    if (!detectKind(file.name)) return NextResponse.json({ ok: false, error: ERR.E008, code: "E008" }, { status: 400 });

    const taskId = newTaskId();
    const traceId = newTraceId();
    const ruleId = ruleIdRaw ? Number(ruleIdRaw) : null;
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength === 0) return NextResponse.json({ ok: false, error: "文件为空" }, { status: 400 });
    const base64 = buf.toString("base64");

    // 任务 + 解析单元 + Outbox 事件：单条语句 = 单事务（原子），不携带大文件字节以保证 <1s
    await db.query(
      `WITH t AS (
         INSERT INTO import_tasks (id,file_name,rule_id,status,trace_id)
         VALUES ($1,$2,$3,'pending',$4) RETURNING id
       ), b AS (
         INSERT INTO import_task_batches (task_id,unit_id,batch_index,kind,status)
         VALUES ($1,'unit_000',0,'parse','pending')
       ), o AS (
         INSERT INTO event_outbox (id,aggregate_id,event_type,schema_version,payload,trace_id)
         VALUES ($5,$1,'ImportTaskCreated',1,$6::jsonb,$4)
       )
       SELECT id FROM t`,
      [taskId, file.name, ruleId, traceId, newEventId(), JSON.stringify({ task_id: taskId, unit_id: "unit_000" })]
    );

    await trace({ traceId, taskId, event: "ImportTaskCreated", message: `上传 ${file.name}，创建任务` });

    // 文件字节后台落库（不阻塞响应）；解析单元会等其就绪
    void db.query(`UPDATE import_tasks SET file_bytes=$1 WHERE id=$2`, [base64, taskId]).catch(() => {});

    // 响应返回后后台推进（不阻塞上传）
    kick(undefined, 8000);

    return NextResponse.json({
      ok: true,
      data: { task_id: taskId, trace_id: traceId, status: "PENDING", total_rows: 0, total_batches: 0 },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const rows = (await db.query(
      `SELECT id,file_name,status,total_rows,processed_rows,success_rows,failed_rows,total_batches,trace_id,degraded,created_at
       FROM import_tasks ORDER BY created_at DESC LIMIT 50`,
      []
    )) as Record<string, unknown>[];
    return NextResponse.json({ ok: true, data: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
