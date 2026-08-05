"use client";
import { useRef, useState, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ItemRow, TargetField } from "@/lib/engine/types";
import type { ValidationResult } from "@/lib/validate";

export interface Column {
  key: TargetField;
  label: string;
  width: number;
}

export const COLUMNS: Column[] = [
  { key: "externalCode", label: "外部编码", width: 140 },
  { key: "store", label: "收货门店", width: 160 },
  { key: "receiverName", label: "收件人姓名", width: 120 },
  { key: "receiverPhone", label: "收件人电话", width: 130 },
  { key: "receiverAddress", label: "收件人地址", width: 220 },
  { key: "skuCode", label: "SKU编码", width: 130 },
  { key: "skuName", label: "SKU名称", width: 200 },
  { key: "skuQty", label: "发货数量", width: 100 },
  { key: "skuSpec", label: "规格型号", width: 130 },
  { key: "remark", label: "备注", width: 130 },
];

const ACTION_W = 60;
const ROW_H = 40;

interface Props {
  rows: ItemRow[];
  validation: ValidationResult;
  onChange: (row: number, field: TargetField, value: string) => void;
  onDelete: (row: number) => void;
}

export default function PreviewTable({ rows, validation, onChange, onDelete }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ row: number; field: TargetField } | null>(null);
  const [draft, setDraft] = useState("");

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const totalWidth = COLUMNS.reduce((s, c) => s + c.width, 0) + ACTION_W;

  const startEdit = useCallback((row: number, field: TargetField, current: string) => {
    setEditing({ row, field });
    setDraft(current);
  }, []);

  const commit = useCallback(() => {
    if (editing) onChange(editing.row, editing.field, draft);
    setEditing(null);
  }, [editing, draft, onChange]);

  const cellErrors = (row: number, field: TargetField): string[] => {
    const errs = validation.errorByRow.get(row) || [];
    return errs.filter((e) => e.field === field).map((e) => e.message);
  };
  const rowLevelErr = (row: number): string[] => {
    const errs = validation.errorByRow.get(row) || [];
    return errs.filter((e) => e.field === "receiver").map((e) => e.message);
  };

  return (
    <div className="table-wrap" style={{ maxHeight: 560 }}>
      <div ref={parentRef} style={{ height: 560, overflow: "auto", position: "relative" }}>
        <div style={{ width: totalWidth, minWidth: "100%" }}>
          {/* 表头 */}
          <div
            className="flex sticky top-0 z-10"
            style={{ background: "#e8fafa", borderBottom: "1px solid #b5e8e8" }}
          >
            {COLUMNS.map((c) => (
              <div
                key={c.key}
                className="px-3 py-2.5 text-[13px] font-semibold text-brand-dark whitespace-nowrap"
                style={{ width: c.width, flexShrink: 0 }}
              >
                {c.label}
              </div>
            ))}
            <div className="px-2 py-2.5 text-[13px] font-semibold text-brand-dark" style={{ width: ACTION_W }}>
              操作
            </div>
          </div>

          {/* 虚拟行 */}
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              const isDup = validation.dupExisting.has(vi.index) || validation.dupBatch.has(vi.index);
              const rowErrs = rowLevelErr(vi.index);
              const rowBg = isDup ? "#fff1f0" : rowErrs.length ? "#fffbe6" : vi.index % 2 ? "#fafcfc" : "#fff";
              return (
                <div
                  key={vi.key}
                  className="absolute left-0 top-0 flex w-full items-center border-b border-line"
                  style={{ height: ROW_H, transform: `translateY(${vi.start}px)`, background: rowBg }}
                >
                  {COLUMNS.map((c) => {
                    const isEditing = editing?.row === vi.index && editing?.field === c.key;
                    const errs = cellErrors(vi.index, c.key);
                    const val = String((row as Record<string, unknown>)[c.key] ?? "");
                    return (
                      <div
                        key={c.key}
                        className="px-3 text-[13px] text-ink-2 whitespace-nowrap overflow-hidden text-ellipsis cursor-text"
                        style={{
                          width: c.width,
                          flexShrink: 0,
                          height: ROW_H,
                          lineHeight: `${ROW_H}px`,
                          boxShadow: errs.length ? "inset 0 0 0 1.5px #cf1322" : undefined,
                          background: errs.length ? "#fff1f0" : undefined,
                        }}
                        title={errs.length ? errs.join("；") : val}
                        onClick={() => startEdit(vi.index, c.key, val)}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="input !py-1 !px-1 !text-[13px]"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={commit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commit();
                              if (e.key === "Escape") setEditing(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          val || <span className="text-ink-3">—</span>
                        )}
                      </div>
                    );
                  })}
                  <div className="px-2 flex items-center" style={{ width: ACTION_W }}>
                    <button
                      className="text-danger text-xs hover:underline"
                      onClick={() => onDelete(vi.index)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
