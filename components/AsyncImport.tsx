"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Rule { id: number; name: string; fileType: string; }

export default function AsyncImport() {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleId, setRuleId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/rules").then((r) => r.json()).then((j) => {
      if (j.ok) { setRules(j.data); if (j.data[0]) setRuleId(String(j.data[0].id)); }
    }).catch(() => {});
  }, []);

  const submit = async () => {
    if (!file) { toast.error("请先选择文件"); return; }
    if (!ruleId) { toast.error("请选择解析规则"); return; }
    if (submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("ruleId", ruleId);
      const t0 = performance.now();
      const resp = await fetch("/api/import-tasks", { method: "POST", body: fd });
      const ms = Math.round(performance.now() - t0);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "上传失败");
      toast.success(`上传成功（${ms}ms），任务已进入异步处理`);
      router.push(`/tasks/${json.data.task_id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fade-in space-y-4">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink">异步批量导入</h2>
        <p className="text-sm text-ink-3 mt-0.5 mb-4">
          上传即返回 task_id，后台异步解析/校验/批量入库；支持 Excel / Word / PDF。上传后自动跳转任务进度页。
        </p>

        <div
          className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${drag ? "border-brand bg-brand-soft" : "border-line hover:border-brand"}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
        >
          <div className="text-4xl mb-2">📄</div>
          {file ? (
            <div>
              <div className="text-sm font-medium text-ink">{file.name}</div>
              <div className="text-xs text-ink-3 mt-1">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
          ) : (
            <div className="text-sm text-ink-3">点击选择文件，或拖拽到此处</div>
          )}
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.docx,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }} />
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="block text-sm text-ink-2 mb-1">解析规则（复用 V2 规则引擎）</label>
            <select className="input" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
              {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary w-full" onClick={submit} disabled={submitting}>
              {submitting ? <span className="spinner" /> : "⬆"} 上传并创建任务
            </button>
          </div>
        </div>
      </div>

      <div className="card p-5 text-sm text-ink-2">
        <div className="font-medium text-ink mb-2">异步链路说明</div>
        上传 → 创建 import_tasks + Outbox（同事务）→ Dispatcher 投递 → Worker 分批处理（批量校验 + 批量 UPSERT）→ 行级错误 + 性能日志 + Trace。
        可在「导入任务」查看进度，「监控看板」查看吞吐/积压/耗时/错误分布，「Trace 检索」定位失败行。
      </div>
    </div>
  );
}
