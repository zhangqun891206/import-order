"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface TraceResult {
  task: { id: string; trace_id: string; file_name: string; status: string };
  events: { event_name: string; event_status: string; message: string; occurred_at: string; unit_id: string | null }[];
  errors: { batch_index: number; row_number: number; field_name: string; raw_value: string; error_code: string; error_reason: string; suggestion: string; unit_id: string | null }[];
}

function TracesInner() {
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") || "");
  const [code, setCode] = useState("");
  const [row, setRow] = useState("");
  const [results, setResults] = useState<TraceResult[]>([]);
  const [loaded, setLoaded] = useState(false);

  const search = (qq = q) => {
    const p = new URLSearchParams();
    if (qq) p.set("q", qq);
    if (code) p.set("error_code", code);
    if (row) p.set("row", row);
    fetch(`/api/traces?${p}`).then((r) => r.json()).then((j) => { if (j.ok) setResults(j.data); setLoaded(true); }).catch(() => setLoaded(true));
  };

  useEffect(() => { search(q); }, []);

  return (
    <div className="fade-in space-y-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-ink">全链路 Trace 检索</h2>
        <p className="text-sm text-ink-3 mt-0.5 mb-3">按 task_id / trace_id / 文件名 / 批次 / 行号 / 错误码搜索，时间线定位失败节点。</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input className="input" placeholder="task_id / trace_id / 文件名" value={q} onChange={(e) => setQ(e.target.value)} />
          <input className="input" placeholder="错误码 E001" value={code} onChange={(e) => setCode(e.target.value)} />
          <input className="input" placeholder="行号" value={row} onChange={(e) => setRow(e.target.value)} />
          <button className="btn btn-primary" onClick={() => search()}>搜索</button>
        </div>
      </div>

      {loaded && results.length === 0 && <div className="card p-10 text-center text-ink-3 text-sm">无匹配结果。</div>}

      {results.map((r) => (
        <div key={r.task.id} className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="font-mono text-xs text-ink-2">task: {r.task.id} · trace: {r.task.trace_id}</div>
            <div className="text-sm text-ink-2">{r.task.file_name} · <span className="tag">{r.task.status}</span></div>
          </div>

          {/* 时间线 */}
          <div className="space-y-1 border-l-2 border-brand-border pl-4">
            {r.events.map((e, i) => (
              <div key={i} className="relative text-sm">
                <span className={`absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full ${e.event_status === "error" ? "bg-danger" : e.event_status === "warn" ? "bg-warn" : "bg-brand"}`} />
                <span className="font-mono text-xs text-ink-3">{new Date(e.occurred_at).toISOString().slice(11, 19)}</span>{" "}
                <span className={e.event_status === "error" ? "text-danger" : "text-ink"}>{e.event_name}</span>{" "}
                <span className="text-ink-3 text-xs">{e.unit_id ? `[${e.unit_id}] ` : ""}{e.message}</span>
              </div>
            ))}
          </div>

          {/* 失败节点明细 */}
          {r.errors.length > 0 && (
            <div className="mt-4">
              <div className="text-sm font-medium text-ink mb-2">失败节点（{r.errors.length}）</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>单元</th><th>批次</th><th>行号</th><th>字段</th><th>原始值</th><th>错误码</th><th>原因</th><th>建议</th></tr></thead>
                  <tbody>
                    {r.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{e.unit_id || "—"}</td><td>{e.batch_index}</td><td>{e.row_number}</td>
                        <td>{e.field_name}</td><td className="font-mono text-xs">{e.raw_value || "—"}</td>
                        <td><span className="tag tag-danger">{e.error_code}</span></td><td>{e.error_reason}</td><td className="text-xs">{e.suggestion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function TracesPage() {
  return (
    <Suspense fallback={<div className="card p-10 text-center text-ink-3 text-sm">加载中…</div>}>
      <TracesInner />
    </Suspense>
  );
}
