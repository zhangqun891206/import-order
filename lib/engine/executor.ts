import type {
  ParseRule,
  RuleSpec,
  FieldMapping,
  FieldSource,
  TargetField,
  ItemRow,
  Waybill,
  ParseResult,
  TableLayout,
  MatrixLayout,
  CardLayout,
  SkipRule,
  CellValue,
} from "./types";
import type { NormalizedDocument, IRSheet } from "../ir/types";

// ============================================================
// 规则引擎执行器：纯函数，浏览器 / Node / Web Worker 通用。
// 输入 = 归一化文档 IR + 规则 JSON；输出 = 结构化运单。
// 无任何文件名 / 特定列名硬编码。
// ============================================================

export function executeRule(doc: NormalizedDocument, rule: ParseRule): ParseResult {
  const spec = rule.spec;
  const warnings: string[] = [];
  const rows: ItemRow[] = [];

  if (doc.fileKind === "excel") {
    const sheets = selectSheets(doc, spec);
    if (sheets.length === 0) warnings.push("未找到可解析的工作表");
    for (const sheet of sheets) {
      rows.push(...parseSheet(sheet, spec, warnings));
    }
  } else {
    // word / pdf：文本类
    rows.push(...parseText(doc, spec, warnings));
  }

  const waybills = aggregate(rows, spec);
  return { rows, waybills, warnings };
}

// ---------------- Sheet 选择 ----------------
function selectSheets(doc: NormalizedDocument, spec: RuleSpec): IRSheet[] {
  const mode = spec.sheet?.mode || "all";
  if (mode === "first") return doc.sheets.slice(0, 1);
  if (mode === "byIndex") {
    const idx = spec.sheet?.indexes || [];
    return doc.sheets.filter((s) => idx.includes(s.index));
  }
  return doc.sheets; // all
}

// ---------------- 单元格读取（含合并单元格回溯） ----------------
function getCell(sheet: IRSheet, r: number, c: number): CellValue {
  if (r < 0 || c < 0 || r >= sheet.rows.length) return "";
  const row = sheet.rows[r];
  if (!row || c >= row.length) return "";
  const v = row[c];
  if (v !== "" && v !== null && v !== undefined) return v;
  // 合并单元格：回溯到左上角
  for (const m of sheet.merges) {
    if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) {
      return getCell(sheet, m.r1, m.c1);
    }
  }
  return "";
}

function cellStr(sheet: IRSheet, r: number, c: number): string {
  const v = getCell(sheet, r, c);
  return v === null || v === undefined ? "" : String(v);
}

// ---------------- 表头定位 ----------------
function locateHeaderRow(sheet: IRSheet, loc: TableLayout["headerLocate"]): number {
  if (typeof loc.rowIndex === "number") return loc.rowIndex;
  if (loc.matchText) {
    for (let r = 0; r < sheet.rows.length; r++) {
      const joined = sheet.rows[r].map((x) => String(x ?? "")).join("|");
      if (joined.includes(loc.matchText)) return r;
    }
  }
  return 0;
}

// ---------------- 列定位：按表头文本匹配 / 按序号 ----------------
function resolveColumn(sheet: IRSheet, headerRow: number, src: { index?: number; headerMatch?: string }): number | null {
  if (typeof src.index === "number") return src.index;
  if (src.headerMatch) {
    const target = src.headerMatch.replace(/\*|｜/g, "").trim();
    const headers = sheet.rows[headerRow] || [];
    for (let c = 0; c < headers.length; c++) {
      const h = String(headers[c] ?? "").replace(/\*|\s/g, "").trim();
      if (h && (h === target || h.includes(target) || target.includes(h))) return c;
    }
  }
  return null;
}

// ---------------- 跳过判定 ----------------
function shouldSkipRow(row: CellValue[], skips: SkipRule[] | undefined): boolean {
  if (!skips) return false;
  const joined = row.map((x) => String(x ?? "")).join("|");
  for (const s of skips) {
    if (s.scope !== "row") continue;
    if (s.when.cellContains && joined.includes(s.when.cellContains)) return true;
    if (s.when.lineMatches && new RegExp(s.when.lineMatches).test(joined)) return true;
  }
  return false;
}

// ---------------- 标签-值提取（表格内） ----------------
function findLabelValueInSheet(sheet: IRSheet, label: string, regex?: string): string {
  const labelNorm = label.replace(/[:：\s]/g, "");
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    for (let c = 0; c < row.length; c++) {
      const cellTxt = String(row[c] ?? "").trim();
      if (!cellTxt) continue;
      const cellNorm = cellTxt.replace(/\s/g, "");
      // 单元格内嵌 "标签：值"
      if (cellNorm.startsWith(labelNorm) || cellTxt.startsWith(label)) {
        const inline = cellTxt.split(/[:：]/);
        if (inline.length > 1 && inline.slice(1).join(":").trim()) {
          return maybeRegex(inline.slice(1).join(":").trim(), regex);
        }
        // 值在右侧相邻单元格
        const right = nextNonEmptyRight(sheet, r, c);
        if (right !== "") return maybeRegex(right, regex);
      }
      // 单元格恰为标签，值在右侧
      if (cellNorm === labelNorm) {
        const right = nextNonEmptyRight(sheet, r, c);
        if (right !== "") return maybeRegex(right, regex);
      }
    }
  }
  return "";
}

function nextNonEmptyRight(sheet: IRSheet, r: number, c: number): string {
  const row = sheet.rows[r] || [];
  for (let cc = c + 1; cc < row.length; cc++) {
    const v = String(row[cc] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function maybeRegex(value: string, regex?: string): string {
  if (!regex) return value;
  try {
    const m = value.match(new RegExp(regex));
    return m ? (m[1] !== undefined ? m[1] : m[0]) : value;
  } catch {
    return value;
  }
}

// ---------------- 变换 ----------------
function applyTransform(value: string, t?: FieldMapping["transform"]): string {
  if (!t) return value;
  if (t === "trim") return value.trim();
  if (t === "toNumber") {
    const n = parseFloat(value.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? String(n) : value;
  }
  if (t === "phoneNormalize") return value.replace(/[^0-9+\-]/g, "");
  try {
    return value.replace(new RegExp(t.regex, "g"), t.replace);
  } catch {
    return value;
  }
}

// ---------------- 字段来源求值（表格行上下文） ----------------
interface RowCtx {
  sheet: IRSheet;
  rowIndex: number;
  headerRow: number;
  spec: RuleSpec;
  /** 卡片/记录范围内搜索标签 */
  searchRange?: [number, number];
  /** 记录级预提取的标签值 */
  recordLabels?: Partial<Record<TargetField, string>>;
}

function resolveField(src: FieldSource, ctx: RowCtx, mapping: FieldMapping): string {
  let val = "";
  switch (src.kind) {
    case "column": {
      const col = resolveColumn(ctx.sheet, ctx.headerRow, src);
      if (col !== null) val = cellStr(ctx.sheet, ctx.rowIndex, col);
      break;
    }
    case "labelValue": {
      if (ctx.recordLabels && ctx.recordLabels[mapping.target]) {
        val = ctx.recordLabels[mapping.target] || "";
      } else {
        val = findLabelValueInSheet(ctx.sheet, src.label, src.regex);
      }
      break;
    }
    case "regex": {
      const scopeText =
        src.scope === "doc" ? ctx.sheet.rows.map((r) => r.join(" ")).join("\n") : ctx.sheet.rows[ctx.rowIndex]?.join(" ") || "";
      try {
        const m = scopeText.match(new RegExp(src.pattern));
        val = m ? (m[src.group] !== undefined ? m[src.group] : m[0]) : "";
      } catch {
        val = "";
      }
      break;
    }
    case "static":
      val = src.value;
      break;
    case "sheetName":
      val = ctx.sheet.name;
      break;
    case "split":
      val = ""; // 由上层处理
      break;
  }
  if (!val && mapping.default !== undefined) val = mapping.default;
  return applyTransform(String(val ?? "").trim(), mapping.transform);
}

// ---------------- 表格布局 ----------------
function parseTable(sheet: IRSheet, layout: TableLayout, spec: RuleSpec, warnings: string[], rowOffset = 0, rowLimit?: number): ItemRow[] {
  const rows: ItemRow[] = [];
  const headerRow = locateHeaderRow(sheet, layout.headerLocate);

  let start = layout.dataRange.start === "afterHeader" ? headerRow + 1 : layout.dataRange.start;
  let end = sheet.rows.length;
  if (typeof layout.dataRange.end === "number") end = layout.dataRange.end;
  else if (layout.dataRange.end && "untilText" in layout.dataRange.end) {
    for (let r = start; r < sheet.rows.length; r++) {
      if (sheet.rows[r].map((x) => String(x ?? "")).join("|").includes(layout.dataRange.end.untilText)) {
        end = r;
        break;
      }
    }
  }
  if (typeof rowLimit === "number") end = Math.min(end, rowLimit);
  start = Math.max(start, rowOffset);

  for (let r = start; r < end; r++) {
    const rawRow = sheet.rows[r] || [];
    if (rawRow.every((c) => String(c ?? "").trim() === "")) continue; // 空行
    if (shouldSkipRow(rawRow, spec.skip)) continue;

    const ctx: RowCtx = { sheet, rowIndex: r, headerRow, spec };
    const item: ItemRow = { _source: { sheet: sheet.name, row: r + 1 } };
    for (const f of spec.fields) {
      (item as Record<string, unknown>)[f.target] = resolveField(f.source, ctx, f);
    }
    if (hasSkuSignal(item)) rows.push(item);
  }
  return rows;
}

function hasSkuSignal(item: ItemRow): boolean {
  return Boolean((item.skuCode && String(item.skuCode).trim()) || (item.skuName && String(item.skuName).trim()));
}

// ---------------- 矩阵布局 ----------------
function parseMatrix(sheet: IRSheet, layout: MatrixLayout, spec: RuleSpec): ItemRow[] {
  const rows: ItemRow[] = [];
  const headerRow = layout.rowEntity.headerRowIndex;
  const [colStart, colEnd] = layout.colEntity.colRange;
  const colHeaderTarget = layout.colHeaderTarget || "store";
  const valueTarget = layout.valueTarget || "skuQty";

  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const rawRow = sheet.rows[r] || [];
    if (rawRow.every((c) => String(c ?? "").trim() === "")) continue;
    if (shouldSkipRow(rawRow, spec.skip)) continue;

    // 行实体字段（列映射）
    const baseCtx: RowCtx = { sheet, rowIndex: r, headerRow, spec };
    const base: ItemRow = { _source: { sheet: sheet.name, row: r + 1 } };
    for (const f of spec.fields) {
      if (f.source.kind === "column") {
        (base as Record<string, unknown>)[f.target] = resolveField(f.source, baseCtx, f);
      } else if (f.source.kind === "static" || f.source.kind === "sheetName") {
        (base as Record<string, unknown>)[f.target] = resolveField(f.source, baseCtx, f);
      }
    }
    if (!hasSkuSignal(base)) continue;

    for (let c = colStart; c <= colEnd; c++) {
      const colHeader = cellStr(sheet, layout.colEntity.headerRowIndex, c).trim();
      if (!colHeader) continue;
      const rawVal = getCell(sheet, r, c);
      const valStr = String(rawVal ?? "").trim();
      const num = parseFloat(valStr.replace(/[^0-9.\-]/g, ""));
      if (layout.value.skipEmptyOrZero && (valStr === "" || num === 0)) continue;

      if (layout.cellSplit && valStr.includes(layout.cellSplit.delimiter)) {
        // 复合单元格拆分
        const parts = valStr.split(layout.cellSplit.delimiter);
        const groups = layout.cellSplit.groups || {};
        for (const part of parts) {
          if (!part.trim()) continue;
          const item: ItemRow = { ...base, [colHeaderTarget]: colHeader };
          try {
            const m = part.match(new RegExp(layout.cellSplit.itemPattern));
            if (m) {
              for (const [field, gi] of Object.entries(groups)) {
                (item as Record<string, unknown>)[field] = m[gi] ?? "";
              }
            } else {
              item.skuName = part.trim();
            }
          } catch {
            item.skuName = part.trim();
          }
          if (hasSkuSignal(item)) rows.push(item);
        }
      } else {
        const item: ItemRow = {
          ...base,
          [colHeaderTarget]: colHeader,
          [valueTarget]: Number.isFinite(num) && valStr !== "" ? num : valStr,
        };
        rows.push(item);
      }
    }
  }
  return rows;
}

// ---------------- 卡片布局 ----------------
function parseCard(sheet: IRSheet, layout: CardLayout, spec: RuleSpec, warnings: string[]): ItemRow[] {
  const rows: ItemRow[] = [];
  const markerRe = layout.marker.regex ? new RegExp(layout.marker.regex) : null;

  // 找到所有卡片起始行
  const starts: number[] = [];
  for (let r = 0; r < sheet.rows.length; r++) {
    const joined = sheet.rows[r].map((x) => String(x ?? "")).join(" ");
    const hit = markerRe ? markerRe.test(joined) : layout.marker.matchText ? joined.includes(layout.marker.matchText) : false;
    if (hit) starts.push(r);
  }
  if (starts.length === 0) {
    warnings.push("卡片布局未找到任何卡片边界");
    return rows;
  }

  for (let i = 0; i < starts.length; i++) {
    const cardStart = starts[i];
    const cardEnd = i + 1 < starts.length ? starts[i + 1] : sheet.rows.length;

    // 提取卡片内标签值
    const recordLabels: Partial<Record<TargetField, string>> = {};
    for (const lb of layout.inner.labels) {
      recordLabels[lb.target] = findLabelInRange(sheet, cardStart, cardEnd, lb.label, lb.regex);
    }

    // 卡片内小表
    const inner = layout.inner.table;
    const headerRow = locateHeaderRowInRange(sheet, cardStart, cardEnd, inner.headerLocate);
    const start = inner.dataRange.start === "afterHeader" ? headerRow + 1 : inner.dataRange.start;
    let end = cardEnd;
    if (typeof inner.dataRange.end === "number") end = Math.min(inner.dataRange.end, cardEnd);

    for (let r = start; r < end; r++) {
      const rawRow = sheet.rows[r] || [];
      if (rawRow.every((c) => String(c ?? "").trim() === "")) continue;
      if (shouldSkipRow(rawRow, spec.skip)) continue;
      const ctx: RowCtx = { sheet, rowIndex: r, headerRow, spec, recordLabels };
      const item: ItemRow = { _source: { sheet: sheet.name, row: r + 1 }, ...recordLabels };
      for (const f of spec.fields) {
        if (f.source.kind === "column") {
          (item as Record<string, unknown>)[f.target] = resolveField(f.source, ctx, f);
        } else if (f.source.kind === "static" || f.source.kind === "sheetName") {
          (item as Record<string, unknown>)[f.target] = resolveField(f.source, ctx, f);
        }
        // labelValue 已通过 recordLabels 注入
      }
      if (hasSkuSignal(item)) rows.push(item);
    }
  }
  return rows;
}

function locateHeaderRowInRange(sheet: IRSheet, from: number, to: number, loc: TableLayout["headerLocate"]): number {
  if (typeof loc.rowIndex === "number") return from + loc.rowIndex;
  if (loc.matchText) {
    for (let r = from; r < to; r++) {
      if (sheet.rows[r].map((x) => String(x ?? "")).join("|").includes(loc.matchText)) return r;
    }
  }
  return from;
}

function findLabelInRange(sheet: IRSheet, from: number, to: number, label: string, regex?: string): string {
  const labelNorm = label.replace(/[:：\s]/g, "");
  for (let r = from; r < to; r++) {
    const row = sheet.rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cellTxt = String(row[c] ?? "").trim();
      if (!cellTxt) continue;
      const cellNorm = cellTxt.replace(/\s/g, "");
      if (cellNorm.startsWith(labelNorm)) {
        const inline = cellTxt.split(/[:：]/);
        if (inline.length > 1 && inline.slice(1).join(":").trim()) return maybeRegex(inline.slice(1).join(":").trim(), regex);
        const right = nextNonEmptyRight(sheet, r, c);
        if (right) return maybeRegex(right, regex);
      }
      if (cellNorm === labelNorm) {
        const right = nextNonEmptyRight(sheet, r, c);
        if (right) return maybeRegex(right, regex);
      }
    }
  }
  return "";
}

// ---------------- 文本布局（Word / PDF） ----------------
function parseText(doc: NormalizedDocument, spec: RuleSpec, warnings: string[]): ItemRow[] {
  const lines = doc.text?.lines || [];
  const layout = spec.layout;
  if (layout.type !== "text") {
    // 文本文件但配置了表格类布局：将文本行转伪表格
    const pseudo = textToSheet(lines);
    return parseSheet(pseudo, spec, warnings);
  }

  let workLines = lines;
  if (layout.textMerge?.lineStartRegex) {
    workLines = mergeLines(lines, layout.textMerge.lineStartRegex, spec.skip);
  }

  // 记录分隔
  let records: string[][] = [workLines];
  if (layout.recordSeparator?.regex) {
    const sep = new RegExp(layout.recordSeparator.regex);
    const chunks: string[][] = [];
    let cur: string[] = [];
    for (const ln of workLines) {
      if (sep.test(ln)) {
        if (cur.length) chunks.push(cur);
        cur = [];
      } else {
        cur.push(ln);
      }
    }
    if (cur.length) chunks.push(cur);
    records = chunks;
  }

  const itemRe = new RegExp(layout.itemLine.regex);
  const rows: ItemRow[] = [];

  for (const record of records) {
    // 记录级标签值（收货人等）
    const recordLabels: Partial<Record<TargetField, string>> = {};
    for (const f of spec.fields) {
      if (f.source.kind === "labelValue") {
        const found = findLabelInLines(record, f.source.label, f.source.regex);
        if (found) recordLabels[f.target] = found;
      } else if (f.source.kind === "static") {
        recordLabels[f.target] = f.source.value;
      } else if (f.source.kind === "regex" && f.source.scope === "doc") {
        const m = record.join("\n").match(new RegExp(f.source.pattern));
        if (m) recordLabels[f.target] = m[f.source.group] ?? m[0];
      }
    }

    for (const ln of record) {
      if (isSkippedLine(ln, spec.skip)) continue;
      const m = ln.match(itemRe);
      if (!m) continue;
      const item: ItemRow = { ...recordLabels };
      for (const [fieldKey, gi] of Object.entries(layout.itemLine.groups)) {
        (item as Record<string, unknown>)[fieldKey] = (m[gi] ?? "").trim();
      }
      if (hasSkuSignal(item)) rows.push(item);
    }
  }
  return rows;
}

function isSkippedLine(line: string, skips?: SkipRule[]): boolean {
  if (!skips) return false;
  for (const s of skips) {
    if (s.scope !== "line") continue;
    if (s.when.cellContains && line.includes(s.when.cellContains)) return true;
    if (s.when.lineMatches && new RegExp(s.when.lineMatches).test(line)) return true;
  }
  return false;
}

function mergeLines(lines: string[], startRe: string, skips?: SkipRule[]): string[] {
  const re = new RegExp(startRe);
  const merged: string[] = [];
  let cur: string | null = null;
  for (const raw of lines) {
    const ln = raw.replace(/\t/g, " ").trim();
    if (!ln) continue;
    if (isSkippedLine(ln, skips)) {
      continue;
    }
    if (re.test(ln)) {
      if (cur !== null) merged.push(cur);
      cur = ln;
    } else if (cur !== null) {
      cur += " " + ln;
    } else {
      cur = ln;
    }
  }
  if (cur !== null) merged.push(cur);
  return merged;
}

function findLabelInLines(lines: string[], label: string, regex?: string): string {
  const labelNorm = label.replace(/[:：\s]/g, "");
  for (const ln of lines) {
    const norm = ln.replace(/\s/g, "");
    if (norm.includes(labelNorm)) {
      // 取标签后的内容
      const idx = ln.indexOf(label);
      let rest = idx >= 0 ? ln.slice(idx + label.length) : "";
      rest = rest.replace(/^[:：\s]+/, "").trim();
      if (!rest) {
        // 可能是 "标签：值 标签2：值2" 同行，取标签后到下一个标签前
        const m = ln.match(new RegExp(label + "[:：]?\\s*([^\\s]+)"));
        if (m) rest = m[1];
      }
      // 截断到下一个中文标签
      rest = rest.split(/\s+(?=[\u4e00-\u9fa5]{2,}[:：])/)[0].trim();
      if (rest) return maybeRegex(rest, regex);
    }
  }
  return "";
}

/** 文本行 → 伪表格（按制表符分列） */
function textToSheet(lines: string[]): IRSheet {
  const rows = lines.map((ln) => ln.split("\t").map((c) => c.trim() as CellValue));
  const colCount = Math.max(0, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < colCount) r.push("");
  return { name: "text", index: 0, rows, merges: [] };
}

// ---------------- Sheet 分发 ----------------
function parseSheet(sheet: IRSheet, spec: RuleSpec, warnings: string[]): ItemRow[] {
  const layout = spec.layout;
  switch (layout.type) {
    case "table":
      return parseTable(sheet, layout, spec, warnings);
    case "matrix":
      return parseMatrix(sheet, layout, spec);
    case "card":
      return parseCard(sheet, layout, spec, warnings);
    case "text":
      return parseText({ fileName: sheet.name, fileKind: "excel", sheets: [sheet], text: null }, spec, warnings);
    case "multiDoc":
      warnings.push("multiDoc 布局请在文本类文件上使用");
      return [];
    default:
      return [];
  }
}

// ---------------- 聚合 ----------------
function aggregate(rows: ItemRow[], spec: RuleSpec): Waybill[] {
  const by = spec.groupBy?.by;
  const map = new Map<string, Waybill>();
  const order: string[] = [];

  const keyOf = (r: ItemRow): string => {
    if (by) return String((r as Record<string, unknown>)[by] ?? "");
    // 默认按收货信息聚合
    return [r.externalCode || "", r.store || "", r.receiverName || "", r.receiverPhone || "", r.receiverAddress || ""].join("|");
  };

  for (const r of rows) {
    const key = keyOf(r) || `__row_${order.length}_${Math.random()}`;
    if (!map.has(key)) {
      map.set(key, {
        externalCode: r.externalCode,
        receiverMode: "",
        store: r.store,
        receiverName: r.receiverName,
        receiverPhone: r.receiverPhone,
        receiverAddress: r.receiverAddress,
        remark: r.remark,
        items: [],
      });
      order.push(key);
    }
    const wb = map.get(key)!;
    // 补全收货信息
    wb.store = wb.store || r.store;
    wb.receiverName = wb.receiverName || r.receiverName;
    wb.receiverPhone = wb.receiverPhone || r.receiverPhone;
    wb.receiverAddress = wb.receiverAddress || r.receiverAddress;
    wb.externalCode = wb.externalCode || r.externalCode;
    wb.items.push({
      skuCode: r.skuCode,
      skuName: r.skuName,
      qty: r.skuQty,
      spec: r.skuSpec,
      remark: r.remark,
    });
  }

  const result = order.map((k) => {
    const wb = map.get(k)!;
    wb.receiverMode = deriveReceiverMode(wb);
    return wb;
  });
  return result;
}

function deriveReceiverMode(wb: Waybill): "A" | "B" | "" {
  const hasA = Boolean(wb.store && wb.store.trim());
  const hasB = Boolean((wb.receiverName || "").trim() && (wb.receiverPhone || "").trim() && (wb.receiverAddress || "").trim());
  if (hasA && hasB) return "A";
  if (hasA) return "A";
  if (hasB) return "B";
  return "";
}
