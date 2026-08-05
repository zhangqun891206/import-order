import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const batches = (await db.query(
      `SELECT unit_id,batch_index,kind,start_row,end_row,status,retry_count,rows_total,rows_ok,rows_err,completed_at FROM import_task_batches WHERE task_id=$1 ORDER BY batch_index`,
      [id]
    )) as Record<string, unknown>[];
    const perf = (await db.query(
      `SELECT unit_id,batch_index,parse_duration_ms,rule_duration_ms,validate_duration_ms,insert_duration_ms,total_duration_ms,status FROM batch_performance_log WHERE task_id=$1 ORDER BY batch_index`,
      [id]
    )) as Record<string, unknown>[];
    return NextResponse.json({ ok: true, data: { batches, perf } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
