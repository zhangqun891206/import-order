import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trace 搜索：支持 task_id / trace_id / 文件名 / 批次号 / 行号 / 错误码。
 * 返回匹配的任务及其时间线，供前端串联展示。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") || "";
  const taskId = sp.get("task_id");
  const errorCode = sp.get("error_code");
  const rowNumber = sp.get("row");

  try {
    // 先定位任务集合
    let taskIds: string[] = [];
    if (taskId) taskIds = [taskId];
    else if (q) {
      const rows = (await db.query(
        `SELECT id FROM import_tasks WHERE id=$1 OR trace_id=$1 OR file_name ILIKE '%'||$2||'%' LIMIT 20`,
        [q, q]
      )) as { id: string }[];
      taskIds = rows.map((r) => r.id);
    } else {
      const rows = (await db.query(`SELECT id FROM import_tasks ORDER BY created_at DESC LIMIT 20`, [])) as { id: string }[];
      taskIds = rows.map((r) => r.id);
    }

    // 按错误码/行号进一步过滤（通过错误表反查任务）
    if (errorCode || rowNumber) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (errorCode) { params.push(errorCode); where.push(`error_code=$${params.length}`); }
      if (rowNumber) { params.push(Number(rowNumber)); where.push(`row_number=$${params.length}`); }
      const rows = (await db.query(
        `SELECT DISTINCT task_id FROM import_task_errors WHERE ${where.join(" AND ")}`,
        params
      )) as { task_id: string }[];
      const set = new Set(rows.map((r) => r.task_id));
      taskIds = taskIds.filter((t) => set.has(t));
      if (!taskIds.length && !taskId && !q) taskIds = rows.map((r) => r.task_id);
    }

    const result = [];
    for (const tid of taskIds.slice(0, 10)) {
      const t = (await db.query(`SELECT id,trace_id,file_name,status FROM import_tasks WHERE id=$1`, [tid])) as Record<string, unknown>[];
      const ev = (await db.query(
        `SELECT trace_id,task_id,unit_id,event_name,event_status,message,occurred_at FROM trace_events WHERE task_id=$1 ORDER BY occurred_at, id LIMIT 200`,
        [tid]
      )) as Record<string, unknown>[];
      const errs = (await db.query(
        `SELECT batch_index,row_number,field_name,raw_value,error_code,error_reason,suggestion,unit_id FROM import_task_errors WHERE task_id=$1 ORDER BY row_number LIMIT 100`,
        [tid]
      )) as Record<string, unknown>[];
      result.push({ task: t[0], events: ev, errors: errs });
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
