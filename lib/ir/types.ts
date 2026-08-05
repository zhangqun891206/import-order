import type { CellValue } from "../engine/types";

/** 合并单元格区域（0-based，含边界） */
export interface IRMerge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** 归一化工作表：稠密二维网格，空单元格为 '' */
export interface IRSheet {
  name: string;
  index: number;
  rows: CellValue[][];
  merges: IRMerge[];
}

/** 归一化文本文档（Word 段落 / PDF 按 y 坐标重组的行） */
export interface IRText {
  lines: string[];
  pages?: { index: number; lines: string[] }[];
}

/** 统一中间表示（NormalizedDocument） */
export interface NormalizedDocument {
  fileName: string;
  fileKind: "excel" | "word" | "pdf";
  sheets: IRSheet[];
  text: IRText | null;
}
