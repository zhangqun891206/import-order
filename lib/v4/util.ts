// V4 通用工具：ID 生成、脱敏、错误码、计时

const rand = (n = 8) =>
  Array.from({ length: n }, () => "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 36)]).join("");

export const newTaskId = () => `task_${Date.now().toString(36)}${rand(6)}`;
export const newTraceId = () => `trace_${Date.now().toString(36)}${rand(8)}`;
export const newEventId = () => `evt_${Date.now().toString(36)}${rand(8)}`;
export const unitId = (batchIndex: number) => `unit_${String(batchIndex).padStart(3, "0")}`;

// ---------------- 脱敏 ----------------
export function maskPhone(v: string | null | undefined): string {
  const s = String(v ?? "");
  if (!s) return "";
  const d = s.replace(/\D/g, "");
  if (d.length < 7) return "***";
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
}

export function maskAddress(v: string | null | undefined): string {
  const s = String(v ?? "");
  if (!s) return "";
  if (s.length <= 10) return `${s.slice(0, 2)}***`;
  return `${s.slice(0, 6)}***${s.slice(-4)}`;
}

/** 对敏感字段脱敏后用于错误明细 raw_value */
export function maskSensitive(field: string, value: string): string {
  if (/phone|电话/i.test(field)) return maskPhone(value);
  if (/address|地址/i.test(field)) return maskAddress(value);
  return value && value.length > 60 ? value.slice(0, 60) + "…" : value;
}

// ---------------- 错误码 ----------------
export const ERR = {
  E001: "SKU 不存在",
  E002: "必填字段缺失",
  E003: "电话格式错误",
  E004: "数量不是正数",
  E005: "外部编码重复",
  E006: "规则映射失败",
  E007: "数据库写入失败",
  E008: "文件格式不支持",
} as const;
export type ErrCode = keyof typeof ERR;

export const SUGGESTION: Record<ErrCode, string> = {
  E001: "请核对 SKU 编码是否在商品主数据中，或联系主数据维护。",
  E002: "请补全该行必填字段后重新导入。",
  E003: "请使用 11 位手机号或带区号座机格式。",
  E004: "发货数量必须为大于 0 的数字。",
  E005: "同一外部编码+SKU 重复，请合并或删除重复行。",
  E006: "请检查解析规则字段映射是否匹配该文件结构。",
  E007: "数据库写入失败，可稍后重试或联系运维。",
  E008: "请上传 .xlsx/.xls/.docx/.pdf 文件。",
};

export const now = () => Date.now();
