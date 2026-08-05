"use client";
import type { FieldMapping, TargetField, FieldSource, RuleSpec } from "@/lib/engine/types";
import { TARGET_LABELS } from "./FieldMappingEditor";

const TARGETS = Object.keys(TARGET_LABELS) as TargetField[];

type Kind = "column" | "labelValue" | "static" | "sheetName" | "regex";
const KIND_LABELS: Record<Kind, string> = {
  column: "表格列",
  labelValue: "标签-值",
  static: "静态值",
  sheetName: "Sheet名",
  regex: "正则",
};

interface Props {
  spec: RuleSpec;
  fieldMeta?: Partial<Record<TargetField, { inferred: boolean; note?: string }>>;
  onChange: (spec: RuleSpec) => void;
}

/** 感知布局类型的统一规则编辑器：布局参数 + 全量两列字段映射 */
export default function RuleSpecEditor({ spec, fieldMeta, onChange }: Props) {
  const layout = spec.layout;
  const fields: FieldMapping[] = Array.isArray(spec.fields) ? spec.fields : [];

  const set = (next: RuleSpec) => onChange(next);
  const setLayout = (patch: Partial<RuleSpec["layout"]>) => set({ ...spec, layout: { ...layout, ...patch } as RuleSpec["layout"] });
  const setFields = (next: FieldMapping[]) => set({ ...spec, fields: next });

  const updateField = (i: number, patch: Partial<FieldMapping>) =>
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const meta = (t: TargetField) => fieldMeta?.[t];

  const targetSelect = (value: TargetField, on: (t: TargetField) => void) => (
    <select className="input" value={value} onChange={(e) => on(e.target.value as TargetField)}>
      {TARGETS.map((t) => (
        <option key={t} value={t}>{TARGET_LABELS[t]}</option>
      ))}
    </select>
  );

  // ---------------- 布局参数面板 ----------------
  const renderLayout = () => {
    switch (layout.type) {
      case "table":
        return (
          <div className="flex flex-wrap gap-2">
            <input className="input !w-40" placeholder="表头匹配文本" value={layout.headerLocate?.matchText || ""}
              onChange={(e) => setLayout({ headerLocate: { ...layout.headerLocate, matchText: e.target.value, rowIndex: e.target.value ? undefined : layout.headerLocate?.rowIndex } })} />
            <input className="input !w-24" type="number" placeholder="表头行号" value={layout.headerLocate?.rowIndex ?? ""}
              onChange={(e) => setLayout({ headerLocate: { matchText: e.target.value === "" ? layout.headerLocate?.matchText : undefined, rowIndex: e.target.value === "" ? undefined : Number(e.target.value) } as never })} />
            <input className="input !w-32" placeholder="截止文本(如 合计)" value={typeof layout.dataRange?.end === "object" && layout.dataRange.end ? (layout.dataRange.end as { untilText?: string }).untilText || "" : ""}
              onChange={(e) => setLayout({ dataRange: { ...layout.dataRange, end: e.target.value ? { untilText: e.target.value } : undefined } })} />
          </div>
        );
      case "matrix":
        return (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-ink-3">表头行</span>
            <input className="input !w-20" type="number" value={layout.rowEntity?.headerRowIndex ?? 0}
              onChange={(e) => setLayout({ rowEntity: { ...layout.rowEntity, headerRowIndex: Number(e.target.value) || 0 }, colEntity: { ...layout.colEntity, headerRowIndex: Number(e.target.value) || 0 } })} />
            <span className="text-xs text-ink-3">门店列范围</span>
            <input className="input !w-16" type="number" value={layout.colEntity?.colRange?.[0] ?? 0}
              onChange={(e) => setLayout({ colEntity: { ...layout.colEntity, colRange: [Number(e.target.value) || 0, layout.colEntity?.colRange?.[1] ?? 0] } })} />
            <input className="input !w-16" type="number" value={layout.colEntity?.colRange?.[1] ?? 0}
              onChange={(e) => setLayout({ colEntity: { ...layout.colEntity, colRange: [layout.colEntity?.colRange?.[0] ?? 0, Number(e.target.value) || 0] } })} />
            <label className="flex items-center gap-1 text-xs text-ink-2">
              <input type="checkbox" checked={layout.value?.skipEmptyOrZero ?? true}
                onChange={(e) => setLayout({ value: { skipEmptyOrZero: e.target.checked } })} />
              跳过空/0
            </label>
          </div>
        );
      case "card":
        return (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-ink-3">卡片标志</span>
            <input className="input !w-40" placeholder="如 调拨记录" value={layout.marker?.matchText || ""}
              onChange={(e) => setLayout({ marker: { ...layout.marker, matchText: e.target.value } })} />
            <span className="text-xs text-ink-3">小表表头</span>
            <input className="input !w-32" placeholder="如 物品编码" value={layout.inner?.table?.headerLocate?.matchText || ""}
              onChange={(e) => setLayout({ inner: { ...layout.inner, table: { ...layout.inner.table, headerLocate: { matchText: e.target.value } } } })} />
          </div>
        );
      case "text":
        return (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-ink-3">物品行正则</span>
            <input className="input flex-1 min-w-[240px] font-mono !text-xs" value={layout.itemLine?.regex || ""}
              onChange={(e) => setLayout({ itemLine: { ...layout.itemLine, regex: e.target.value } })} />
            <span className="text-xs text-ink-3">折行合并</span>
            <input className="input !w-32 font-mono !text-xs" placeholder="^\\d+" value={layout.textMerge?.lineStartRegex || ""}
              onChange={(e) => setLayout({ textMerge: e.target.value ? { lineStartRegex: e.target.value } : undefined })} />
          </div>
        );
      default:
        return <div className="text-xs text-ink-3">该布局类型请在下方 JSON 中编辑。</div>;
    }
  };

  // ---------------- 字段行（fields） ----------------
  const renderFieldRow = (f: FieldMapping, i: number) => {
    const kind = (f.source?.kind as Kind) || "column";
    return (
      <div key={`f${i}`} className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-white p-3 md:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">应用字段{meta(f.target)?.inferred && <span className="tag tag-warn">AI 推测</span>}</div>
          {targetSelect(f.target, (t) => updateField(i, { target: t }))}
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-3">文件来源 / 规则</div>
          <div className="flex flex-wrap gap-2">
            <select className="input !w-auto" value={kind}
              onChange={(e) => {
                const k = e.target.value as Kind;
                const d: Record<Kind, FieldSource> = {
                  column: { kind: "column", headerMatch: "" },
                  labelValue: { kind: "labelValue", label: "", scope: "doc" },
                  static: { kind: "static", value: "" },
                  sheetName: { kind: "sheetName" },
                  regex: { kind: "regex", pattern: "", group: 1, scope: "line" },
                };
                updateField(i, { source: d[k] });
              }}>
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            {kind === "column" && (
              <input className="input !w-40" placeholder="表头文本" value={(f.source as { headerMatch?: string }).headerMatch || ""}
                onChange={(e) => updateField(i, { source: { kind: "column", headerMatch: e.target.value } })} />
            )}
            {kind === "labelValue" && (
              <>
                <input className="input !w-32" placeholder="标签" value={(f.source as { label?: string }).label || ""}
                  onChange={(e) => updateField(i, { source: { kind: "labelValue", label: e.target.value, scope: (f.source as { scope?: never }).scope || "doc" } })} />
                <select className="input !w-auto" value={(f.source as { scope?: string }).scope || "doc"}
                  onChange={(e) => updateField(i, { source: { kind: "labelValue", label: (f.source as { label?: string }).label || "", scope: e.target.value as never } })}>
                  <option value="doc">全文</option><option value="sheet">当前Sheet</option><option value="card">卡片内</option><option value="row">行内</option>
                </select>
              </>
            )}
            {kind === "static" && (
              <input className="input !w-40" placeholder="固定值" value={(f.source as { value?: string }).value || ""}
                onChange={(e) => updateField(i, { source: { kind: "static", value: e.target.value } })} />
            )}
            {kind === "regex" && (
              <input className="input !w-40 font-mono !text-xs" placeholder="正则" value={(f.source as { pattern?: string }).pattern || ""}
                onChange={(e) => updateField(i, { source: { kind: "regex", pattern: e.target.value, group: (f.source as { group?: number }).group ?? 1, scope: "line" } })} />
            )}
            <select className="input !w-auto" value={typeof f.transform === "string" ? f.transform : ""}
              onChange={(e) => updateField(i, { transform: (e.target.value || undefined) as FieldMapping["transform"] })}>
              <option value="">不变换</option><option value="trim">去空格</option><option value="toNumber">转数字</option><option value="phoneNormalize">电话清洗</option>
            </select>
            <button className="btn btn-danger !px-2 !py-1 text-xs" onClick={() => setFields(fields.filter((_, idx) => idx !== i))}>删除</button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------- 布局派生映射行 ----------------
  const renderLayoutRows = () => {
    const rows: React.ReactNode[] = [];
    if (layout.type === "matrix") {
      const colT = layout.colHeaderTarget || "store";
      const valT = layout.valueTarget || "skuQty";
      rows.push(
        <div key="mcol" className="grid grid-cols-1 gap-3 rounded-lg border border-brand-border bg-brand-soft/40 p-3 md:grid-cols-2">
          <div><div className="mb-1 text-xs text-ink-3">应用字段（矩阵列头）</div>{targetSelect(colT, (t) => setLayout({ colHeaderTarget: t }))}</div>
          <div className="text-sm text-ink-2 self-center">来源：矩阵列头（门店/日期列 {layout.colEntity?.colRange?.[0]}–{layout.colEntity?.colRange?.[1]}）</div>
        </div>,
        <div key="mval" className="grid grid-cols-1 gap-3 rounded-lg border border-brand-border bg-brand-soft/40 p-3 md:grid-cols-2">
          <div><div className="mb-1 text-xs text-ink-3">应用字段（矩阵值）</div>{targetSelect(valT, (t) => setLayout({ valueTarget: t }))}</div>
          <div className="text-sm text-ink-2 self-center">来源：矩阵单元格数值（非 0 才生成记录）</div>
        </div>
      );
    }
    if (layout.type === "card") {
      (layout.inner?.labels || []).forEach((lb, i) => {
        rows.push(
          <div key={`c${i}`} className="grid grid-cols-1 gap-3 rounded-lg border border-brand-border bg-brand-soft/40 p-3 md:grid-cols-2">
            <div><div className="mb-1 text-xs text-ink-3">应用字段（卡片标签）</div>{targetSelect(lb.target, (t) => setLayout({ inner: { ...layout.inner, labels: layout.inner.labels.map((x, xi) => (xi === i ? { ...x, target: t } : x)) } }))}</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-3">卡片内标签</span>
              <input className="input !w-40" value={lb.label}
                onChange={(e) => setLayout({ inner: { ...layout.inner, labels: layout.inner.labels.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)) } })} />
            </div>
          </div>
        );
      });
    }
    if (layout.type === "text") {
      Object.entries(layout.itemLine?.groups || {}).forEach(([tgt, gi]) => {
        rows.push(
          <div key={`t${tgt}`} className="grid grid-cols-1 gap-3 rounded-lg border border-brand-border bg-brand-soft/40 p-3 md:grid-cols-2">
            <div><div className="mb-1 text-xs text-ink-3">应用字段（行正则组）</div>{targetSelect(tgt as TargetField, (t) => setLayout({ itemLine: { ...layout.itemLine, groups: Object.fromEntries(Object.entries(layout.itemLine.groups || {}).map(([k, v]) => [k === tgt ? t : k, v])) } }))}</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-3">正则捕获组 #</span>
              <input className="input !w-16" type="number" value={gi as number}
                onChange={(e) => setLayout({ itemLine: { ...layout.itemLine, groups: { ...layout.itemLine.groups, [tgt]: Number(e.target.value) || 1 } } })} />
            </div>
          </div>
        );
      });
    }
    return rows;
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-sm font-medium text-ink">布局类型：<span className="tag">{layout.type}</span></div>
        {renderLayout()}
      </div>

      <div>
        <div className="mb-1 text-sm font-medium text-ink">字段映射（左：应用字段 → 右：文件来源/规则）</div>
        <div className="space-y-2">
          {fields.map(renderFieldRow)}
          {renderLayoutRows()}
        </div>
        <button className="btn btn-ghost !py-1.5 text-sm mt-2"
          onClick={() => setFields([...fields, { target: "skuName", source: { kind: "column", headerMatch: "" } }])}>
          ＋ 添加字段映射
        </button>
      </div>
    </div>
  );
}
