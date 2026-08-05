"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import type { ParseRule, ItemRow, TargetField } from "@/lib/engine/types";
import type { NormalizedDocument } from "@/lib/ir/types";
import { normalizeFile, runParse, summarize, detectKind } from "@/lib/client/parse";
import { validateRows, type ValidationResult } from "@/lib/validate";
import PreviewTable from "./PreviewTable";
import RuleEditor from "./RuleEditor";

type Step = "upload" | "preview";

const KIND_LABEL = { excel: "Excel", word: "Word", pdf: "PDF" } as const;

export default function ImportFlow() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [doc, setDoc] = useState<NormalizedDocument | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [rules, setRules] = useState<ParseRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<number | "new" | null>(null);

  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, done: 0, total: 0 });
  const [parseError, setParseError] = useState<string | null>(null);

  const [rows, setRows] = useState<ItemRow[]>([]);
  const [existingCodes, setExistingCodes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: number; failed: number; total: number } | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ParseRule | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadRules = useCallback(async () => {
    try {
      const resp = await fetch("/api/rules");
      const json = await resp.json();
      if (json.ok) setRules(json.data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const summary = useMemo(() => (doc ? summarize(doc) : null), [doc]);

  // ---------- 上传 ----------
  const handleFile = useCallback(async (f: File) => {
    setParseError(null);
    setSubmitResult(null);
    if (!detectKind(f.name)) {
      toast.error("不支持的文件格式，请上传 .xlsx / .xls / .docx / .pdf");
      return;
    }
    setFile(f);
    setStep("upload");
    try {
      const normalized = await normalizeFile(f);
      setDoc(normalized);
    } catch (e) {
      setDoc(null);
      setParseError(`文件读取失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // ---------- 解析 ----------
  const selectedRule = useMemo(
    () => rules.find((r) => r.id === selectedRuleId) || null,
    [rules, selectedRuleId]
  );

  const handleParse = useCallback(async () => {
    if (!doc || !selectedRule) return;
    setParsing(true);
    setParseError(null);
    setSubmitResult(null);
    try {
      const result = runParse(doc, selectedRule);
      if (!result.rows.length) {
        setParseError("未能从文件中解析出任何数据行。请检查规则配置，或点击下方「新建规则」由 AI 分析生成。");
        setParsing(false);
        return;
      }
      const all = result.rows;
      setProgress({ pct: 0, done: 0, total: all.length });
      // 分片注入，驱动进度条
      const CHUNK = 200;
      let i = 0;
      setRows([]);
      await new Promise<void>((resolve) => {
        const stepOnce = () => {
          i = Math.min(i + CHUNK, all.length);
          setRows(all.slice(0, i));
          setProgress({ done: i, total: all.length, pct: Math.round((i / all.length) * 100) });
          if (i < all.length) setTimeout(stepOnce, 16);
          else resolve();
        };
        stepOnce();
      });
      // 查重
      const codes = Array.from(new Set(all.map((r) => (r.externalCode || "").trim()).filter(Boolean)));
      try {
        const resp = await fetch("/api/waybills/check-dup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codes }),
        });
        const json = await resp.json();
        setExistingCodes(new Set(json?.data?.existing || []));
      } catch {
        setExistingCodes(new Set());
      }
      setStep("preview");
      toast.success(`解析完成：${all.length} 行数据`);
    } catch (e) {
      setParseError(`解析失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setParsing(false);
    }
  }, [doc, selectedRule]);

  // ---------- 预览编辑 ----------
  const validation: ValidationResult = useMemo(
    () => validateRows(rows, existingCodes),
    [rows, existingCodes]
  );

  const handleCellChange = useCallback((row: number, field: TargetField, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[row] = { ...next[row], [field]: field === "skuQty" && value !== "" && !isNaN(Number(value)) ? Number(value) : value };
      return next;
    });
  }, []);

  const handleDeleteRow = useCallback((row: number) => {
    setRows((prev) => prev.filter((_, i) => i !== row));
  }, []);

  const handleAddRow = useCallback(() => {
    setRows((prev) => [...prev, {}]);
  }, []);

  const handleExport = useCallback(() => {
    const data = rows.map((r) => ({
      外部编码: r.externalCode || "",
      收货门店: r.store || "",
      收件人姓名: r.receiverName || "",
      收件人电话: r.receiverPhone || "",
      收件人地址: r.receiverAddress || "",
      SKU物品编码: r.skuCode || "",
      SKU物品名称: r.skuName || "",
      SKU发货数量: r.skuQty ?? "",
      SKU规格型号: r.skuSpec || "",
      备注: r.remark || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "导入数据");
    XLSX.writeFile(wb, `导入预览_${Date.now()}.xlsx`);
    toast.success("已导出 Excel 文件");
  }, [rows]);

  // ---------- 提交 ----------
  const groupToWaybills = useCallback((list: ItemRow[]) => {
    const map = new Map<string, {
      externalCode?: string; storeName?: string; receiverName?: string; receiverPhone?: string; receiverAddress?: string; remark?: string;
      items: { skuCode: string; skuName: string; qty: number | string; spec?: string; remark?: string }[];
    }>();
    const order: string[] = [];
    for (const r of list) {
      const code = (r.externalCode || "").trim();
      const key = code || ["s", r.store || "", r.receiverName || "", r.receiverPhone || "", r.receiverAddress || ""].join("|");
      if (!map.has(key)) {
        map.set(key, {
          externalCode: code || undefined,
          storeName: r.store || undefined,
          receiverName: r.receiverName || undefined,
          receiverPhone: r.receiverPhone || undefined,
          receiverAddress: r.receiverAddress || undefined,
          remark: r.remark || undefined,
          items: [],
        });
        order.push(key);
      }
      const wb = map.get(key)!;
      wb.storeName = wb.storeName || r.store || undefined;
      wb.receiverName = wb.receiverName || r.receiverName || undefined;
      wb.receiverPhone = wb.receiverPhone || r.receiverPhone || undefined;
      wb.receiverAddress = wb.receiverAddress || r.receiverAddress || undefined;
      wb.items.push({ skuCode: r.skuCode || "", skuName: r.skuName || "", qty: r.skuQty ?? "", spec: r.skuSpec || undefined, remark: r.remark || undefined });
    }
    return order.map((k) => map.get(k)!);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (validation.errors.length) {
      toast.error(`存在 ${validation.errors.length} 处校验错误，请先修正后再提交`);
      return;
    }
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const waybills = groupToWaybills(rows);
      const resp = await fetch("/api/waybills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file?.name, ruleId: selectedRuleId === "new" ? null : selectedRuleId, waybills }),
      });
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error || "提交失败");
      setSubmitResult({ success: json.data.success, failed: json.data.failed, total: json.data.total });
      toast.success(`提交成功：${json.data.success} 个运单`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }, [rows, validation.errors.length, groupToWaybills, file, selectedRuleId]);

  const reset = () => {
    setStep("upload");
    setFile(null);
    setDoc(null);
    setRows([]);
    setSelectedRuleId(null);
    setParseError(null);
    setSubmitResult(null);
    setProgress({ pct: 0, done: 0, total: 0 });
  };

  // ================= 渲染 =================
  return (
    <div className="fade-in">
      {step === "upload" && (
        <div className="space-y-4">
          {/* 上传卡片 */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-ink mb-1">上传出库单文件</h2>
            <p className="text-sm text-ink-3 mb-4">支持 Excel（.xlsx/.xls）、Word（.docx）、PDF，拖拽或点击上传</p>
            <div
              className={`rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors ${
                dragOver ? "border-brand bg-brand-soft" : "border-line hover:border-brand"
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
            >
              <div className="text-4xl mb-2">📄</div>
              {file ? (
                <div>
                  <div className="text-sm font-medium text-ink">{file.name}</div>
                  <div className="text-xs text-ink-3 mt-1">
                    {doc ? `${KIND_LABEL[detectKind(file.name)!]} · ${doc.sheets.length ? doc.sheets.length + " 个工作表" : (doc.text?.lines.length || 0) + " 行文本"}` : "解析结构中…"}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-ink-3">点击选择文件，或将文件拖拽到此处</div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.docx,.pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
            </div>
            {parseError && (
              <div className="mt-3 rounded-lg bg-danger-soft border border-[#ffccc7] p-3 text-sm text-danger">
                {parseError}
                {doc && (
                  <div className="mt-2 text-xs text-ink-2 whitespace-pre-wrap max-h-32 overflow-auto bg-white/60 rounded p-2">
                    {summary}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 规则选择 */}
          {doc && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold text-ink">选择解析规则</h3>
                <button className="btn btn-primary" onClick={() => { setEditingRule(null); setEditorOpen(true); }}>
                  ＋ 新建规则
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rules.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRuleId(r.id!)}
                    className={`text-left rounded-xl border p-4 transition-all ${
                      selectedRuleId === r.id ? "border-brand bg-brand-soft" : "border-line hover:border-brand-border"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink text-sm">{r.name}</span>
                      {r.source === "ai" && <span className="tag tag-warn">AI</span>}
                    </div>
                    {r.description && <div className="text-xs text-ink-3 mt-1">{r.description}</div>}
                  </button>
                ))}
                {rules.length === 0 && <div className="text-sm text-ink-3">暂无规则，请点击「新建规则」创建（可用 AI 自动生成）。</div>}
              </div>

              <div className="flex items-center gap-3 mt-5">
                <button
                  className="btn btn-primary"
                  disabled={!selectedRule || selectedRuleId === "new" || parsing}
                  onClick={handleParse}
                >
                  {parsing ? <span className="spinner" /> : "▶"} 开始解析
                </button>
                {selectedRule && typeof selectedRuleId === "number" && (
                  <button className="btn btn-outline" onClick={() => { setEditingRule(selectedRule); setEditorOpen(true); }}>
                    编辑当前规则
                  </button>
                )}
              </div>

              {parsing && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-ink-3 mb-1">
                    <span>正在解析…</span>
                    <span>{progress.done}/{progress.total} 行 · {progress.pct}%</span>
                  </div>
                  <div className="progress"><div style={{ width: `${progress.pct}%` }} /></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ink">数据预览与编辑</h2>
                <div className="text-sm text-ink-3 mt-0.5">
                  共 {rows.length} 行 · 错误 {validation.errors.length} 处 ·
                  重复 {validation.dupExisting.size + validation.dupBatch.size} 处
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-outline" onClick={handleAddRow}>＋ 新增空行</button>
                <button className="btn btn-outline" onClick={handleExport}>⬇ 导出 Excel</button>
                <button className="btn btn-ghost" onClick={reset}>重新导入</button>
                <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || validation.errors.length > 0}>
                  {submitting ? <span className="spinner" /> : "✓"} 提交下单
                </button>
              </div>
            </div>

            {submitting && (
              <div className="mt-3"><div className="progress"><div style={{ width: "70%" }} /></div></div>
            )}
            {submitResult && (
              <div className="mt-3 rounded-lg bg-brand-soft border border-brand-border p-3 text-sm text-brand-dark">
                提交完成：成功 {submitResult.success} 个运单，失败 {submitResult.failed} 个（共 {submitResult.total} 个）。可在「已导入运单」中查看。
              </div>
            )}
          </div>

          {validation.errors.length > 0 && (
            <div className="card p-4">
              <div className="text-sm font-semibold text-danger mb-2">校验错误（{validation.errors.length}）</div>
              <div className="max-h-40 overflow-auto text-sm text-ink-2 space-y-1">
                {validation.errors.map((e, i) => (
                  <div key={i}>第 {e.row + 1} 行 · {e.message}</div>
                ))}
              </div>
            </div>
          )}

          <PreviewTable rows={rows} validation={validation} onChange={handleCellChange} onDelete={handleDeleteRow} />
        </div>
      )}

      <RuleEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initialRule={editingRule}
        docSummary={summary}
        doc={doc}
        onSaved={() => { loadRules(); }}
      />
    </div>
  );
}
