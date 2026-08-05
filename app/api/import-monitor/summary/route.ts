import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 1. 实时吞吐：过去 5 分钟每分钟成功入库行数
    const throughput = (await db.query(
      `SELECT to_char(date_trunc('minute', completed_at),'HH24:MI') AS m, COALESCE(SUM(rows_ok),0)::int AS rows
       FROM import_task_batches WHERE kind='batch' AND completed_at > now() - interval '5 minutes'
       GROUP BY 1 ORDER BY 1`,
      []
    )) as { m: string; rows: number }[];

    // 2. 队列积压：待处理批次数 + 行数
    const backlog = (await db.query(
      `SELECT COUNT(*)::int AS units, COALESCE(SUM(rows_total),0)::int AS rows FROM import_task_batches WHERE status IN ('pending','processing')`,
      []
    )) as { units: number; rows: number }[];

    // 3. 阶段耗时分布 P50/P95/P99
    const phase = (await db.query(
      `SELECT
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY parse_duration_ms)::int    AS p_p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY parse_duration_ms)::int    AS p_p95,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY parse_duration_ms)::int    AS p_p99,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY validate_duration_ms)::int AS v_p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY validate_duration_ms)::int AS v_p95,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY validate_duration_ms)::int AS v_p99,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY insert_duration_ms)::int   AS i_p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY insert_duration_ms)::int   AS i_p95,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY insert_duration_ms)::int   AS i_p99,
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY rule_duration_ms)::int     AS r_p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY rule_duration_ms)::int     AS r_p95,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY rule_duration_ms)::int     AS r_p99
       FROM batch_performance_log WHERE kind IS NULL OR true`,
      []
    )) as Record<string, number | null>[];

    // 4. 错误类型分布
    const errDist = (await db.query(
      `SELECT error_code, COUNT(*)::int n FROM import_task_errors GROUP BY error_code ORDER BY n DESC`,
      []
    )) as { error_code: string; n: number }[];

    // 慢批次 TOP10
    const slow = (await db.query(
      `SELECT task_id,unit_id,batch_index,total_duration_ms,status FROM batch_performance_log ORDER BY total_duration_ms DESC NULLS LAST LIMIT 10`,
      []
    )) as Record<string, unknown>[];

    // 任务状态概览
    const tasks = (await db.query(
      `SELECT status, COUNT(*)::int n FROM import_tasks GROUP BY status`,
      []
    )) as { status: string; n: number }[];

    return NextResponse.json({
      ok: true,
      data: {
        throughput,
        backlog: backlog[0],
        phase: phase[0],
        error_distribution: errDist,
        slow_batches: slow,
        task_status: tasks,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
