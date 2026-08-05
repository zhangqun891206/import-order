"use client";
import type { FieldMapping, TargetField, FieldSource } from "@/lib/engine/types";

export const TARGET_LABELS: Record<TargetField, string> = {
  externalCode: "外部编码",
  store: "收货门店",
  receiverName: "收件人姓名",
  receiverPhone: "收件人电话",
  receiverAddress: "收件人地址",
  skuCode: "SKU物品编码",
  skuName: "SKU物品名称",
  skuQty: "SKU发货数量",
  skuSpec: "SKU规格型号",
  remark: "备注",
};

const TARGETS = Object.keys(TARGET_LABELS) as TargetField[];

type Kind = "column" | "labelValue" | "static" | "sheetName" | "regex";
const KIND_LABELS: Record<Kind, string> = {
  column: "表格列",
  labelValue: "标签-值",
  static: "静态值",
  sheetName: "Sheet名",
  regex: "正则",
};

function kindOf(src: FieldSource): Kind {
  return (src?.kind as Kind) || "column";
}

interface Props {
  fields: FieldMapping[];
  inferred?: Partial<Record<TargetField, { inferred: boolean; note?: string }>>;
  onChange: (fields: FieldMapping[]) => void;
}

/** 两列对照的字段映射编辑器：左=应用字段，右=文件来源及规则 */
export default function FieldMappingEditor({ fields, inferred, onChange }: Props) {
  const update = (i: number, patch: Partial<FieldMapping>) => {
    const next = fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange(next);
  };

  const setSource = (i: number, src: FieldSource) => update(i, { source: src });

  const setKind = (i: number, kind: Kind) => {
    // 切换来源类型时给出合理默认结构
    const defaults: Record<Kind, FieldSource> = {
      column: { kind: "column", headerMatch: "" },
      labelValue: { kind: "labelValue", label: "", scope: "doc" },
      static: { kind: "static", value: "" },
      sheetName: { kind: "sheetName" },
      regex: { kind: "regex", pattern: "", group: 1, scope: "line" },
    };
    setSource(i, defaults[kind]);
  };

  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));

  const add = () =>
    onChange([
      ...fields,
      { target: "skuName", source: { kind: "column", headerMatch: "" } },
    ]);

  return (
    <div className="space-y-2">
      {fields.map((f, i) => {
        const kind = kindOf(f.source);
        const meta = inferred?.[f.target];
        return (
          <div
            key={i}
            className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-white p-3 md:grid-cols-2"
          >
            {/* 左：应用字段 */}
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs text-ink-3">
                应用字段
                {meta?.inferred && <span className="tag tag-warn">AI 推测</span>}
              </div>
              <select
                className="input"
                value={f.target}
                onChange={(e) => update(i, { target: e.target.value as TargetField })}
              >
                {TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
              {meta?.note && <div className="mt-1 text-xs text-warn">{meta.note}</div>}
            </div>

            {/* 右：文件来源及规则 */}
            <div>
              <div className="mb-1 text-xs text-ink-3">文件来源 / 规则</div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="input !w-auto"
                  value={kind}
                  onChange={(e) => setKind(i, e.target.value as Kind)}
                >
                  {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>

                {kind === "column" && (
                  <>
                    <input
                      className="input !w-40"
                      placeholder="表头文本，如 物品编码"
                      value={(f.source as { headerMatch?: string }).headerMatch || ""}
                      onChange={(e) =>
                        setSource(i, { kind: "column", headerMatch: e.target.value })
                      }
                    />
                    <input
                      className="input !w-20"
                      type="number"
                      placeholder="列号"
                      value={(f.source as { index?: number }).index ?? ""}
                      onChange={(e) =>
                        setSource(i, {
                          kind: "column",
                          headerMatch: (f.source as { headerMatch?: string }).headerMatch,
                          index: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </>
                )}

                {kind === "labelValue" && (
                  <>
                    <input
                      className="input !w-32"
                      placeholder="标签，如 收货人"
                      value={(f.source as { label?: string }).label || ""}
                      onChange={(e) =>
                        setSource(i, {
                          kind: "labelValue",
                          label: e.target.value,
                          scope: (f.source as { scope?: "row" | "card" | "sheet" | "doc" }).scope || "doc",
                        })
                      }
                    />
                    <select
                      className="input !w-auto"
                      value={(f.source as { scope?: string }).scope || "doc"}
                      onChange={(e) =>
                        setSource(i, {
                          kind: "labelValue",
                          label: (f.source as { label?: string }).label || "",
                          scope: e.target.value as "row" | "card" | "sheet" | "doc",
                        })
                      }
                    >
                      <option value="doc">全文</option>
                      <option value="sheet">当前Sheet</option>
                      <option value="card">卡片内</option>
                      <option value="row">行内</option>
                    </select>
                  </>
                )}

                {kind === "static" && (
                  <input
                    className="input !w-40"
                    placeholder="固定值"
                    value={(f.source as { value?: string }).value || ""}
                    onChange={(e) => setSource(i, { kind: "static", value: e.target.value })}
                  />
                )}

                {kind === "regex" && (
                  <>
                    <input
                      className="input !w-40"
                      placeholder="正则"
                      value={(f.source as { pattern?: string }).pattern || ""}
                      onChange={(e) =>
                        setSource(i, {
                          kind: "regex",
                          pattern: e.target.value,
                          group: (f.source as { group?: number }).group ?? 1,
                          scope: (f.source as { scope?: "line" | "doc" }).scope || "line",
                        })
                      }
                    />
                    <input
                      className="input !w-16"
                      type="number"
                      placeholder="组号"
                      value={(f.source as { group?: number }).group ?? 1}
                      onChange={(e) =>
                        setSource(i, {
                          kind: "regex",
                          pattern: (f.source as { pattern?: string }).pattern || "",
                          group: Number(e.target.value) || 1,
                          scope: (f.source as { scope?: "line" | "doc" }).scope || "line",
                        })
                      }
                    />
                  </>
                )}

                <select
                  className="input !w-auto"
                  value={typeof f.transform === "string" ? f.transform : ""}
                  onChange={(e) =>
                    update(i, { transform: (e.target.value || undefined) as FieldMapping["transform"] })
                  }
                  title="变换"
                >
                  <option value="">不变换</option>
                  <option value="trim">去空格</option>
                  <option value="toNumber">转数字</option>
                  <option value="phoneNormalize">电话清洗</option>
                </select>

                <button className="btn btn-danger !px-2 !py-1 text-xs" onClick={() => remove(i)}>
                  删除
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <button className="btn btn-ghost !py-1.5 text-sm" onClick={add}>
        ＋ 添加字段映射
      </button>
    </div>
  );
}
