"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ParseRule } from "@/lib/engine/types";
import RuleEditor from "@/components/RuleEditor";

const FILE_TYPE_LABEL: Record<string, string> = { excel: "Excel", word: "Word", pdf: "PDF", auto: "自动" };

export default function RulesPage() {
  const [rules, setRules] = useState<ParseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ParseRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/rules");
      const json = await resp.json();
      if (json.ok) setRules(json.data);
    } catch {
      toast.error("加载规则失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除该规则？")) return;
    try {
      const resp = await fetch(`/api/rules/${id}`, { method: "DELETE" });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error);
      toast.success("已删除");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleDuplicate = async (id: number) => {
    try {
      const resp = await fetch(`/api/rules/${id}/duplicate`, { method: "POST" });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error);
      toast.success("已复制规则");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "复制失败");
    }
  };

  return (
    <div className="fade-in space-y-4">
      <div className="card p-5 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">解析规则管理</h2>
          <p className="text-sm text-ink-3 mt-0.5">规则持久化在服务端，可创建、编辑、复制、删除；导入时手动选择使用。</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setEditorOpen(true); }}>＋ 新建规则</button>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-ink-3 text-sm">加载中…</div>
        ) : rules.length === 0 ? (
          <div className="p-10 text-center text-ink-3 text-sm">暂无规则，点击「新建规则」创建。</div>
        ) : (
          <div className="table-wrap !border-0 !rounded-none">
            <table className="data-table">
              <thead>
                <tr>
                  <th>规则名称</th>
                  <th>文件类型</th>
                  <th>来源</th>
                  <th>说明</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-ink">{r.name}</td>
                    <td><span className="tag">{FILE_TYPE_LABEL[r.fileType] || r.fileType}</span></td>
                    <td>{r.source === "ai" ? <span className="tag tag-warn">AI</span> : <span className="tag">手动</span>}</td>
                    <td className="max-w-[260px] truncate" title={r.description}>{r.description || "—"}</td>
                    <td className="text-xs">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "—"}</td>
                    <td>
                      <div className="flex gap-2">
                        <button className="text-brand-dark text-xs hover:underline" onClick={() => { setEditing(r); setEditorOpen(true); }}>编辑</button>
                        <button className="text-ink-2 text-xs hover:underline" onClick={() => handleDuplicate(r.id!)}>复制</button>
                        <button className="text-danger text-xs hover:underline" onClick={() => handleDelete(r.id!)}>删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RuleEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initialRule={editing}
        docSummary={null}
        doc={null}
        onSaved={load}
      />
    </div>
  );
}
