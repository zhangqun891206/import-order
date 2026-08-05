"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ParseRule, RuleFileType } from "@/lib/engine/types";
import type { NormalizedDocument } from "@/lib/ir/types";
import { executeRule } from "@/lib/engine/executor";

interface Props {
  open: boolean;
  onClose: () => void;
  initialRule: ParseRule | null;
  docSummary: string | null;
  doc: NormalizedDocument | null;
  onSaved: () => void;
}

const EMPTY_SPEC = `{
  "layout": { "type": "table", "headerLocate": { "rowIndex": 0 }, "dataRange": { "start": "afterHeader" }, "itemFieldsInRow": true },
  "fields": [
    { "target": "skuCode", "source": { "kind": "column", "headerMatch": "物品编码" } },
    { "target": "skuName", "source": { "kind": "column", "headerMatch": "物品名称" } },
    { "target": "skuQty", "source": { "kind": "column", "headerMatch": "数量" }, "transform": "toNumber" }
  ]
}`;

export default function RuleEditor({ open, onClose, initialRule, docSummary, doc, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fileType, setFileType] = useState<RuleFileType>("auto");
  const [specText, setSpecText] = useState(EMPTY_SPEC);
  const [source, setSource] = useState<"manual" | "ai">("manual");
  const [fieldMeta, setFieldMeta] = useState<Record<string, { inferred: boolean; note?: string }>>({});
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialRule) {
      setName(initialRule.name);
      setDescription(initialRule.description || "");
      setFileType(initialRule.fileType);
      setSpecText(JSON.stringify(initialRule.spec, null, 2));
      setSource(initialRule.source || "manual");
      setFieldMeta((initialRule.fieldMeta as Record<string, { inferred: boolean; note?: string }>) || {});
    } else {
      setName("");
      setDescription("");
      setFileType("auto");
      setSpecText(EMPTY_SPEC);
      setSource("manual");
      setFieldMeta({});
    }
    setTestResult(null);
  }, [open, initialRule]);

  const inferredFields = useMemo(
    () => Object.entries(fieldMeta).filter(([, v]) => v?.inferred),
    [fieldMeta]
  );

  if (!open) return null;

  const handleAiGenerate = async () => {
    if (!docSummary) {
      toast.error("请先上传文件，AI 需要文件结构来分析");
      return;
    }
    setAiLoading(true);
    setTestResult(null);
    try {
      const resp = await fetch("/api/rules/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: docSummary }),
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "AI 生成失败");
      const d = json.data;
      setName(d.name || "AI 生成规则");
      setFileType(d.fileType || "auto");
      setSpecText(JSON.stringify(d.spec, null, 2));
      setSource("ai");
      setFieldMeta(d.fieldMeta || {});
      toast.success("AI 已生成规则草稿，请核对带「推测」标记的映射后保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI 生成失败");
    } finally {
      setAiLoading(false);
    }
  };

  const handleTest = () => {
    if (!doc) {
      toast.error("没有可用于试解析的文件");
      return;
    }
    try {
      const spec = JSON.parse(specText);
      const rule: ParseRule = { name: name || "测试规则", fileType, spec };
      const result = executeRule(doc, rule);
      const items = result.waybills.reduce((s, w) => s + w.items.length, 0);
      setTestResult(`试解析成功：${result.waybills.length} 个运单 / ${items} 个物品行${result.warnings.length ? "；警告：" + result.warnings.join("，") : ""}`);
    } catch (e) {
      setTestResult(`试解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleSave = async () => {
    let spec: unknown;
    try {
      spec = JSON.parse(specText);
    } catch {
      toast.error("规则 JSON 格式不正确，请检查");
      return;
    }
    if (!name.trim()) {
      toast.error("请填写规则名称");
      return;
    }
    setSaving(true);
    try {
      const isEdit = initialRule?.id != null;
      const url = isEdit ? `/api/rules/${initialRule!.id}` : "/api/rules";
      const method = isEdit ? "PUT" : "POST";
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, fileType, spec, fieldMeta, source }),
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "保存失败");
      toast.success("规则已保存");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card fade-in w-full max-w-3xl p-6" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "88vh", overflow: "auto" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-ink">{initialRule ? "编辑解析规则" : "新建解析规则"}</h3>
          <button className="btn btn-outline !px-3 !py-1" onClick={onClose}>关闭</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div className="md:col-span-2">
            <label className="block text-sm text-ink-2 mb-1">规则名称</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：某某出库单规则" />
          </div>
          <div>
            <label className="block text-sm text-ink-2 mb-1">文件类型</label>
            <select className="input" value={fileType} onChange={(e) => setFileType(e.target.value as RuleFileType)}>
              <option value="auto">自动</option>
              <option value="excel">Excel</option>
              <option value="word">Word</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-sm text-ink-2 mb-1">规则说明（可选）</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="描述该规则适用的文件结构" />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <button className="btn btn-ghost" onClick={handleAiGenerate} disabled={aiLoading || !docSummary}>
            {aiLoading ? <span className="spinner spinner-dark" /> : "✨"} AI 分析并生成规则
          </button>
          <button className="btn btn-outline" onClick={handleTest} disabled={!doc}>
            试解析当前文件
          </button>
          {source === "ai" && <span className="tag tag-warn">AI 生成 · 需人工确认</span>}
        </div>

        {inferredFields.length > 0 && (
          <div className="rounded-lg bg-warn-soft border border-[#ffe4ba] p-3 mb-3 text-sm text-warn">
            以下字段映射为 AI 推测，请重点核对：
            {inferredFields.map(([k, v]) => (
              <span key={k} className="inline-block ml-2 tag tag-warn">{k}{v.note ? `（${v.note}）` : ""}</span>
            ))}
          </div>
        )}

        {testResult && (
          <div className={`rounded-lg p-3 mb-3 text-sm ${testResult.startsWith("试解析成功") ? "bg-brand-soft text-brand-dark" : "bg-danger-soft text-danger"}`}>
            {testResult}
          </div>
        )}

        <label className="block text-sm text-ink-2 mb-1">规则 JSON（RuleSpec）</label>
        <textarea
          className="input font-mono !text-xs"
          style={{ minHeight: 280, whiteSpace: "pre" }}
          value={specText}
          onChange={(e) => setSpecText(e.target.value)}
          spellCheck={false}
        />

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-outline" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : "保存规则"}
          </button>
        </div>
      </div>
    </div>
  );
}
