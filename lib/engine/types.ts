// ============================================================
// 规则引擎 DSL 类型定义（核心考点）
// 规则 = 一份可持久化、可复用、可由 AI 生成的 JSON 配置。
// 禁止在本文件及执行器中出现任何具体文件名 / 特定列名硬编码。
// ============================================================

/** 下单字段目标（归一化目标字段） */
export type TargetField =
  | "externalCode"
  | "store"
  | "receiverName"
  | "receiverPhone"
  | "receiverAddress"
  | "skuCode"
  | "skuName"
  | "skuQty"
  | "skuSpec"
  | "remark";

/** 单元格标量值 */
export type CellValue = string | number | boolean | null;

// ---------------- 字段来源 ----------------
export type FieldSource =
  | { kind: "column"; index?: number; headerMatch?: string }
  | { kind: "labelValue"; label: string; scope: "row" | "card" | "sheet" | "doc"; regex?: string }
  | { kind: "regex"; pattern: string; group: number; scope: "line" | "doc" }
  | { kind: "static"; value: string }
  | { kind: "sheetName" }
  | { kind: "split"; from: TargetField; delimiter: string; index: number };

export interface FieldMapping {
  target: TargetField;
  source: FieldSource;
  /** 默认值（源取不到值时使用） */
  default?: string;
  /** 变换 */
  transform?:
    | "trim"
    | "toNumber"
    | "phoneNormalize"
    | { regex: string; replace: string };
}

// ---------------- 跳过规则 ----------------
export interface SkipRule {
  when: { cellContains?: string; lineMatches?: string };
  scope: "row" | "line";
}

// ---------------- 布局 ----------------
export interface TableLayout {
  type: "table";
  /** 表头定位：指定行号，或按文本匹配所在行 */
  headerLocate: { rowIndex?: number; matchText?: string };
  /** 数据区范围 */
  dataRange: {
    start: "afterHeader" | number;
    end?: number | { untilText: string };
  };
  /** 物品字段是否随行（列映射） */
  itemFieldsInRow: boolean;
}

export interface MatrixLayout {
  type: "matrix";
  rowEntity: { headerRowIndex: number; labelCols: number[] };
  colEntity: { headerRowIndex: number; colRange: [number, number] };
  value: { skipEmptyOrZero: boolean };
  expandTo: "records";
  /** 复合单元格拆分（周配送计划） */
  cellSplit?: { delimiter: string; itemPattern: string };
  /** 矩阵值 → 哪个目标字段（默认 skuQty） */
  valueTarget?: TargetField;
  /** 列头 → 哪个目标字段（默认 store） */
  colHeaderTarget?: TargetField;
}

export interface CardLayout {
  type: "card";
  marker: { matchText?: string; regex?: string };
  inner: {
    labels: { label: string; target: TargetField; regex?: string }[];
    table: TableLayout;
  };
}

export interface TextLayout {
  type: "text";
  recordSeparator?: { regex: string };
  itemLine: { regex: string; groups: Record<string, number> };
}

export interface MultiDocLayout {
  type: "multiDoc";
  splitBy: { regex?: string; pageBreak?: boolean };
  inner: TableLayout | TextLayout;
}

export type Layout =
  | TableLayout
  | MatrixLayout
  | CardLayout
  | TextLayout
  | MultiDocLayout;

// ---------------- 顶层 ----------------
export interface RuleSpec {
  sheet?: { mode: "all" | "first" | "byIndex"; indexes?: number[] };
  layout: Layout;
  fields: FieldMapping[];
  groupBy?: { by: TargetField };
  skip?: SkipRule[];
}

export type RuleFileType = "excel" | "word" | "pdf" | "auto";

/** AI 逐字段置信标注 */
export interface FieldMeta {
  inferred: boolean;
  note?: string;
}

export interface ParseRule {
  id?: number;
  name: string;
  description?: string;
  fileType: RuleFileType;
  spec: RuleSpec;
  fieldMeta?: Partial<Record<TargetField, FieldMeta>>;
  source?: "manual" | "ai";
  createdAt?: string;
  updatedAt?: string;
}

// ---------------- 解析产物 ----------------
/** 单条物品行（聚合前） */
export interface ItemRow {
  externalCode?: string;
  store?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  skuCode?: string;
  skuName?: string;
  skuQty?: number | string;
  skuSpec?: string;
  remark?: string;
  /** 来源定位信息，便于排错 */
  _source?: { sheet?: string; row?: number };
}

/** 聚合后的运单（出库单） */
export interface Waybill {
  externalCode?: string;
  receiverMode: "A" | "B" | "";
  store?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  remark?: string;
  items: {
    skuCode?: string;
    skuName?: string;
    qty?: number | string;
    spec?: string;
    remark?: string;
  }[];
}

export interface ParseResult {
  rows: ItemRow[];
  waybills: Waybill[];
  warnings: string[];
}
