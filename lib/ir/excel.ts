import * as XLSX from "xlsx";
import type { NormalizedDocument, IRSheet, IRMerge } from "./types";
import type { CellValue } from "../engine/types";

/** 将 Excel 文件（ArrayBuffer）归一化为 IR。浏览器 / Node 通用。 */
export function normalizeExcel(buf: ArrayBuffer | Uint8Array, fileName: string): NormalizedDocument {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const sheets: IRSheet[] = [];

  wb.SheetNames.forEach((name, index) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
    const rowCount = range.e.r + 1;
    const colCount = range.e.c + 1;

    const rows: CellValue[][] = [];
    for (let r = 0; r < rowCount; r++) {
      const row: CellValue[] = [];
      for (let c = 0; c < colCount; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        row.push(cell ? normalizeCell(cell.v) : "");
      }
      rows.push(row);
    }

    const merges: IRMerge[] = (ws["!merges"] || []).map((m) => ({
      r1: m.s.r,
      c1: m.s.c,
      r2: m.e.r,
      c2: m.e.c,
    }));

    sheets.push({ name, index, rows, merges });
  });

  return { fileName, fileKind: "excel", sheets, text: null };
}

function normalizeCell(v: unknown): CellValue {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}
