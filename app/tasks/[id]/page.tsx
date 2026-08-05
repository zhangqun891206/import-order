"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";

interface TaskDetail {
  task_id: string; file_name: string; status: string; total_rows: number; processed_rows: number;
  success_rows: number; failed_rows: number; total_batches: number; completed_batches: number;
  trace_id: string; degraded: boolean; unverified_sku_rows: number; recent_errors: { error_code: string; n: number }[];
}
interface ErrRow { id: number; batch_index: number; row_number: number; field_name: string; raw_value: string; error_code: string; error_reason: string; suggestion: string; }
interface BatchRow { unit_id: string; batch_index: number; kind: string; status: string; rows_total: number; rows_ok: number; rows_err: number; retry_count: number; }
interface PerfRow { batch_index: number; parse_duration_ms: number; rule_duration_ms: number; validate_duration_ms: number; insert_duration_ms: number; total_duration_ms: number; }

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [errors, setErrors] = useState<{ items: ErrRow[]; total: number }>({ items: [], total: 0 });
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [perf, setPerf] = useState<PerfRow[]>([]);
  const [batchFilter, setBatchFilter] = useState("");
  const [codeFilter, setCodeFilter] = useState("");
  const [page, setPage] = useState(1);

  const loadErrors = useCallback(() => {
    const sp = new URLSearchParams({ page: String(page), page_size: "50" });
    if (batchFilter) sp.set("batch", batchFilter);
    if (codeFilter) sp.set("error_code", codeFilter);
    fetch(`/api/import-tasks/${id}/errors?${sp}`).then((r) => r.json()).then((j) => { if (j.ok) setErrors(j.data); }).catch(() => {});
  }, [id, page, batchFilter, codeFilter]);

  useEffect(() => {
    let on = true;
    const load = () => {
      fetch(`/api/import-tasks/${id}`).then((r) => r.json()).then((j) => { if (on && j.ok) setTask(j.data); }).catch(() => {});
      fetch(`/api/import-tasks/${id}/batches`).then((r) => r.json()).then((j) => { if (on && j.ok) { setBatches(j.data.batches); setPerf(j.data.perf); } }).catch(() => {});
      loadErrors();
    };
    load();
    const t = setInterval(load, 1500);
    return () => { on = false; clearInterval(t); };
  }, [id, loadErrors]);

  const exportErrors = () => {
    const data = errors.items.map((e) => ({ 批次: e.batch_index, 行号: e.row_number, 字段: e.field_name, 原始值: e.raw_value, 错误码: e.error_code, 原因: e.error_reason, 建议: e.suggestion }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "errors");
    XLSX.writeFile(wb, `errors_${id}.xlsx`);
  };

  const pct = task && task.total_rows ? Math.round((task.processed_rows / task.total_rows) * 100) : 0;
  const running = task && !["COMPLETED", "PARTIAL_SUCCESS", "FAILED"].includes(task.status);

  return (
    <div className="fade-in space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">任务详情</h2>
            <div className="text-xs text-ink-3 font-mono mt-1">task: {id} · trace: {task?.trace_id}</div>
          </div>
          <div className="flex gap-2">
            <Link className="btn btn-outline" href={`/traces?q=${id}`}>查看 Trace</Link>
            <button className="btn btn-outline" onClick={exportErrors}>导出失败明细</button>
          </div>
        </div>

        {task?.degraded && (
          <div className="mt-3 rounded-lg bg-warn-soft border border-[#ffe4ba] p-3 text-sm text-warn">
            ⚠️ SKU 校验已降级：本次导入未经过商品主数据完整校验（{task.unverified_sku_rows} 行），数据可能需要后续复核。
          </div>
        )}

        {task && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
            <Stat label="状态" value={task.status} />
            <Stat label="总行数" value={String(task.total_rows)} />
            <Stat label="已处理" value={String(task.processed_rows)} />
            <Stat label="成功" value={String(task.success_rows)} good />
            <Stat label="失败" value={String(task.failed_rows)} bad />
            <Stat label="批次" value={`${task.completed_batches}/${task.total_batches}`} />
          </div>
        )}

        <div className="mt-4">
          <div className="flex justify-between text-xs text-ink-3 mb-1">
            <span>{running ? "处理中…" : "已完成"}</span><span>{pct}%</span>
          </div>
          <div className="progress"><div style={{ width: `${pct}%` }} /></div>
        </div>

        {task && task.recent_errors.length > 0 && (
          <div className="mt-3 text-sm text-ink-2">
            最近错误：{task.recent_errors.map((e) => `${e.error_code}×${e.n}`).join("，")}
          </div>
        )}
      </div>

      {/* 错误明细 */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="text-base font-semibold text-ink">行级错误（{errors.total}）</h3>
          <div className="flex gap-2">
            <input className="input !w-24" placeholder="批次" value={batchFilter} onChange={(e) => { setBatchFilter(e.target.value); setPage(1); }} />
            <input className="input !w-28" placeholder="错误码 E001" value={codeFilter} onChange={(e) => { setCodeFilter(e.target.value); setPage(1); }} />
          </div>
        </div>
        {errors.items.length === 0 ? (
          <div className="p-6 text-center text-ink-3 text-sm">无错误记录。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>批次</th><th>行号</th><th>字段</th><th>原始值</th><th>错误码</th><th>原因</th><th>修复建议</th></tr></thead>
              <tbody>
                {errors.items.map((e) => (
                  <tr key={e.id}>
                    <td>{e.batch_index}</td><td>{e.row_number}</td><td>{e.field_name}</td>
                    <td className="font-mono text-xs">{e.raw_value || "—"}</td>
                    <td><span className="tag tag-danger">{e.error_code}</span></td>
                    <td>{e.error_reason}</td><td className="text-xs">{e.suggestion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button className="btn btn-outline !py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
          <span className="text-sm text-ink-3 self-center">第 {page} 页</span>
          <button className="btn btn-outline !py-1.5" disabled={errors.items.length < 50} onClick={() => setPage((p) => p + 1)}>下一页</button>
        </div>
      </div>

      {/* 批次性能 */}
      <div className="card p-5">
        <h3 className="text-base font-semibold text-ink mb-3">处理单元 / 阶段耗时（ms）</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>单元</th><th>类型</th><th>状态</th><th>行数</th><th>解析</th><th>规则</th><th>校验</th><th>写入</th><th>总耗时</th><th>重试</th></tr></thead>
            <tbody>
              {batches.map((b) => {
                const p = perf.find((x) => x.batch_index === b.batch_index && (b.kind === "parse" ? true : true));
                return (
                  <tr key={b.unit_id}>
                    <td className="font-mono text-xs">{b.unit_id}</td><td>{b.kind}</td><td>{b.status}</td>
                    <td>{b.rows_total}（ok {b.rows_ok} / err {b.rows_err}）</td>
                    <td>{p?.parse_duration_ms ?? "—"}</td><td>{p?.rule_duration_ms ?? "—"}</td>
                    <td>{p?.validate_duration_ms ?? "—"}</td><td>{p?.insert_duration_ms ?? "—"}</td>
                    <td>{p?.total_duration_ms ?? "—"}</td><td>{b.retry_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-bg p-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`text-lg font-semibold ${good ? "text-brand-dark" : bad ? "text-danger" : "text-ink"}`}>{value}</div>
    </div>
  );
}
