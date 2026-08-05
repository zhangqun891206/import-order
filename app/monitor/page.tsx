"use client";
import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, CartesianGrid, Legend,
} from "recharts";

interface Summary {
  throughput: { m: string; rows: number }[];
  backlog: { units: number; rows: number };
  phase: Record<string, number | null>;
  error_distribution: { error_code: string; n: number }[];
  slow_batches: Record<string, unknown>[];
  task_status: { status: string; n: number }[];
}

export default function MonitorPage() {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => fetch("/api/import-monitor/summary").then((r) => r.json()).then((j) => { if (on && j.ok) setData(j.data); }).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { on = false; clearInterval(t); };
  }, []);

  const backlogWarn = (data?.backlog?.rows || 0) > 5000;
  const phaseData = data?.phase ? [
    { name: "解析", P50: data.phase.p_p50, P95: data.phase.p_p95, P99: data.phase.p_p99 },
    { name: "规则", P50: data.phase.r_p50, P95: data.phase.r_p95, P99: data.phase.r_p99 },
    { name: "校验", P50: data.phase.v_p50, P95: data.phase.v_p95, P99: data.phase.v_p99 },
    { name: "写入", P50: data.phase.i_p50, P95: data.phase.i_p95, P99: data.phase.i_p99 },
  ] : [];

  return (
    <div className="fade-in space-y-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-ink">导入监控看板</h2>
        <p className="text-sm text-ink-3 mt-0.5">实时吞吐 / 队列积压 / 阶段耗时 / 错误分布，3 秒刷新。</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1 实时吞吐 */}
        <div className="card p-5">
          <h3 className="text-base font-semibold text-ink mb-3">实时吞吐量（成功入库行/分钟）</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={data?.throughput || []}>
                <CartesianGrid stroke="#eee" /><XAxis dataKey="m" fontSize={12} /><YAxis fontSize={12} />
                <Tooltip /><Line type="monotone" dataKey="rows" stroke="#0fc6c2" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2 队列积压 */}
        <div className="card p-5">
          <h3 className="text-base font-semibold text-ink mb-3">队列积压深度</h3>
          <div className={`rounded-xl p-6 text-center ${backlogWarn ? "bg-warn-soft border border-[#ffe4ba]" : "bg-bg"}`}>
            <div className={`text-3xl font-bold ${backlogWarn ? "text-warn" : "text-ink"}`}>{data?.backlog?.rows ?? 0}</div>
            <div className="text-sm text-ink-3 mt-1">待处理行数（{data?.backlog?.units ?? 0} 个处理单元）</div>
            {backlogWarn && <div className="text-warn text-sm mt-2">⚠ 积压超过 5000 行，请关注 Worker 并发</div>}
          </div>
          <div className="mt-3 text-sm text-ink-2">
            任务状态：{(data?.task_status || []).map((t) => `${t.status}×${t.n}`).join("，") || "无"}
          </div>
        </div>

        {/* 3 阶段耗时 */}
        <div className="card p-5">
          <h3 className="text-base font-semibold text-ink mb-3">阶段耗时分布（ms）</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={phaseData}>
                <CartesianGrid stroke="#eee" /><XAxis dataKey="name" fontSize={12} /><YAxis fontSize={12} />
                <Tooltip /><Legend />
                <Bar dataKey="P50" fill="#0fc6c2" /><Bar dataKey="P95" fill="#0bada9" /><Bar dataKey="P99" fill="#0b6e6e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 4 错误分布 */}
        <div className="card p-5">
          <h3 className="text-base font-semibold text-ink mb-3">错误类型分布</h3>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={data?.error_distribution || []} layout="vertical">
                <CartesianGrid stroke="#eee" /><XAxis type="number" fontSize={12} /><YAxis type="category" dataKey="error_code" fontSize={12} width={60} />
                <Tooltip /><Bar dataKey="n" fill="#cf1322" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 慢批次 TOP10 */}
      <div className="card p-5">
        <h3 className="text-base font-semibold text-ink mb-3">慢批次 TOP 10</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>任务</th><th>单元</th><th>批次</th><th>总耗时(ms)</th><th>状态</th></tr></thead>
            <tbody>
              {(data?.slow_batches || []).map((s, i) => (
                <tr key={i}>
                  <td className="font-mono text-xs">{String(s.task_id)}</td><td className="font-mono text-xs">{String(s.unit_id)}</td>
                  <td>{String(s.batch_index)}</td><td>{String(s.total_duration_ms)}</td><td>{String(s.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
