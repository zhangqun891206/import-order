import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { kick } from "@/lib/v4/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    // 轮询顺带推进队列（Serverless Consumer）
    kick(ctx, 6000);

    const t = (await db.query(
      `SELECT id,file_name,rule_id,status,total_rows,processed_rows,success_rows,failed_rows,total_batches,completed_batches,trace_id,degraded,unverified_sku_rows,created_at,completed_at
       FROM import_tasks WHERE id=$1`,
      [id]
    )) as Record<string, unknown>[];
    if (!t.length) return NextResponse.json({ ok: false, error: "任务不存在" }, { status: 404 });
    const task = t[0];

    const recentErr = (await db.query(
      `SELECT error_code, COUNT(*)::int n FROM import_task_errors WHERE task_id=$1 GROUP BY error_code ORDER BY n DESC LIMIT 5`,
      [id]
    )) as { error_code: string; n: number }[];

    return NextResponse.json({
      ok: true,
      data: {
        task_id: task.id,
        file_name: task.file_name,
        status: String(task.status).toUpperCase(),
        total_rows: task.total_rows,
        processed_rows: task.processed_rows,
        success_rows: task.success_rows,
        failed_rows: task.failed_rows,
        total_batches: task.total_batches,
        completed_batches: task.completed_batches,
        trace_id: task.trace_id,
        degraded: task.degraded,
        unverified_sku_rows: task.unverified_sku_rows,
        created_at: task.created_at,
        completed_at: task.completed_at,
        recent_errors: recentErr,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
