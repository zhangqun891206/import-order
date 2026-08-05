import type { ItemRow } from "./engine/types";

export interface RowError {
  row: number; // 0-based
  field: string;
  message: string;
}

const PHONE_RE = /^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|400-?\d{3}-?\d{4})$/;

export function isPositiveNumber(v: unknown): boolean {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0;
}

/** A/B 组收货信息是否满足（A=门店；B=姓名+电话+地址） */
export function hasReceiver(row: ItemRow): boolean {
  const hasA = Boolean(row.store && String(row.store).trim());
  const hasB = Boolean(
    (row.receiverName || "").trim() && (row.receiverPhone || "").trim() && (row.receiverAddress || "").trim()
  );
  return hasA || hasB;
}

export interface ValidationResult {
  errors: RowError[];
  errorByRow: Map<number, RowError[]>;
  /** 与已入库数据重复的行 */
  dupExisting: Set<number>;
  /** 同批次外部编码冲突的行 */
  dupBatch: Set<number>;
}

/**
 * 全量校验：一次性返回所有错误（行号 + 字段 + 原因），并做外部编码重复检测。
 * existingCodes：数据库中已存在的外部编码集合。
 */
export function validateRows(rows: ItemRow[], existingCodes: Set<string>): ValidationResult {
  const errors: RowError[] = [];
  const push = (row: number, field: string, message: string) => errors.push({ row, field, message });

  rows.forEach((r, i) => {
    if (!r.skuCode || !String(r.skuCode).trim()) push(i, "skuCode", "SKU物品编码不能为空");
    if (!r.skuName || !String(r.skuName).trim()) push(i, "skuName", "SKU物品名称不能为空");
    if (!isPositiveNumber(r.skuQty)) push(i, "skuQty", "SKU发货数量必须为正数");
    if (!hasReceiver(r)) push(i, "receiver", "缺少收货信息：收货门店(A组) 或 姓名+电话+地址(B组) 至少一组");
    if (r.receiverPhone && String(r.receiverPhone).trim() && !PHONE_RE.test(String(r.receiverPhone).trim())) {
      push(i, "receiverPhone", "收件人电话格式不正确");
    }
  });

  // 外部编码重复检测
  const dupExisting = new Set<number>();
  const dupBatch = new Set<number>();

  // 与已入库重复
  rows.forEach((r, i) => {
    const code = (r.externalCode || "").trim();
    if (code && existingCodes.has(code)) dupExisting.add(i);
  });

  // 同批次冲突：同一外部编码对应了多组不同的收货信息
  const groups = new Map<string, { sig: string; idx: number }[]>();
  rows.forEach((r, i) => {
    const code = (r.externalCode || "").trim();
    if (!code) return;
    const sig = [r.store || "", r.receiverName || "", r.receiverPhone || "", r.receiverAddress || ""].join("|");
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code)!.push({ sig, idx: i });
  });
  for (const [, list] of groups) {
    const sigs = new Set(list.map((x) => x.sig));
    if (sigs.size > 1) list.forEach((x) => dupBatch.add(x.idx));
  }

  const errorByRow = new Map<number, RowError[]>();
  for (const e of errors) {
    if (!errorByRow.has(e.row)) errorByRow.set(e.row, []);
    errorByRow.get(e.row)!.push(e);
  }

  return { errors, errorByRow, dupExisting, dupBatch };
}
