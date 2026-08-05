import { db } from "../db";

/** 写链路时间线事件（不阻塞主流程，失败静默） */
export async function trace(opts: {
  traceId: string;
  taskId?: string | null;
  unitId?: string | null;
  event: string;
  status?: string;
  message?: string;
}): Promise<void> {
  try {
    await db`
      INSERT INTO trace_events (trace_id, task_id, unit_id, event_name, event_status, message)
      VALUES (${opts.traceId}, ${opts.taskId || null}, ${opts.unitId || null}, ${opts.event}, ${opts.status || "ok"}, ${opts.message || null})
    `;
  } catch {
    /* 观测写入失败不影响主链路 */
  }
}

/** 写处理单元性能日志 */
export async function perfLog(opts: {
  taskId: string;
  unitId: string | null;
  batchIndex: number | null;
  parseMs?: number | null;
  ruleMs?: number | null;
  validateMs?: number | null;
  insertMs?: number | null;
  totalMs?: number | null;
  status?: string;
  traceId?: string | null;
}): Promise<void> {
  try {
    await db`
      INSERT INTO batch_performance_log
        (task_id, unit_id, batch_index, parse_duration_ms, rule_duration_ms, validate_duration_ms, insert_duration_ms, total_duration_ms, status, trace_id)
      VALUES (${opts.taskId}, ${opts.unitId}, ${opts.batchIndex}, ${opts.parseMs ?? null}, ${opts.ruleMs ?? null},
              ${opts.validateMs ?? null}, ${opts.insertMs ?? null}, ${opts.totalMs ?? null}, ${opts.status || "ok"}, ${opts.traceId || null})
    `;
  } catch {
    /* ignore */
  }
}
