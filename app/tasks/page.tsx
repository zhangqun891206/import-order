"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Task {
  id: string; file_name: string; status: string; total_rows: number; processed_rows: number;
  success_rows: number; failed_rows: number; trace_id: string; degraded: boolean; created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "tag", processing: "tag tag-warn", completed: "tag", partial_success: "tag tag-warn", failed: "tag tag-danger",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    let on = true;
    const load = () => fetch("/api/import-tasks").then((r) => r.json()).then((j) => { if (on && j.ok) setTasks(j.data); }).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => { on = false; clearInterval(t); };
  }, []);

  return (
    <div className="fade-in space-y-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-ink">导入任务</h2>
        <p className="text-sm text-ink-3 mt-0.5">异步导入任务列表，2 秒自动刷新。</p>
      </div>
      <div className="card p-0 overflow-hidden">
        {tasks.length === 0 ? (
          <div className="p-10 text-center text-ink-3 text-sm">暂无任务，去首页上传文件创建任务。</div>
        ) : (
          <div className="table-wrap !border-0 !rounded-none">
            <table className="data-table">
              <thead>
                <tr><th>任务</th><th>文件</th><th>状态</th><th>进度</th><th>成功/失败</th><th>降级</th><th>创建时间</th></tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td><Link className="text-brand-dark hover:underline font-mono text-xs" href={`/tasks/${t.id}`}>{t.id}</Link></td>
                    <td>{t.file_name}</td>
                    <td><span className={STATUS_COLOR[t.status] || "tag"}>{t.status}</span></td>
                    <td className="text-xs">{t.processed_rows}/{t.total_rows}</td>
                    <td className="text-xs"><span className="text-brand-dark">{t.success_rows}</span> / <span className="text-danger">{t.failed_rows}</span></td>
                    <td>{t.degraded ? <span className="tag tag-warn">已降级</span> : "—"}</td>
                    <td className="text-xs">{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
