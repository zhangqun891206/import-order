import type { NormalizedDocument } from "../ir/types";

/**
 * 将归一化文档压缩为「结构摘要」文本，作为大模型输入。
 * 目标：控制 token，同时保留足够结构信息供 AI 推断解析规则。
 */
export function summarizeIR(doc: NormalizedDocument, opts?: { maxRows?: number }): string {
  const maxRows = opts?.maxRows ?? 12;
  const parts: string[] = [];
  parts.push(`文件名：${doc.fileName}`);
  parts.push(`文件类型：${doc.fileKind}`);

  if (doc.fileKind === "excel") {
    parts.push(`工作表数量：${doc.sheets.length}`);
    for (const sheet of doc.sheets) {
      parts.push(`\n【Sheet "${sheet.name}"】行数=${sheet.rows.length} 列数=${sheet.rows[0]?.length ?? 0} 合并单元格=${sheet.merges.length}`);
      const nonEmpty = sheet.rows
        .map((row, idx) => ({ row, idx }))
        .filter(({ row }) => row.some((c) => String(c ?? "").trim() !== ""));
      const head = nonEmpty.slice(0, maxRows);
      const tail = nonEmpty.slice(-4).filter((x) => !head.includes(x));
      parts.push("前部非空行（[行号] 列索引:值）：");
      for (const { row, idx } of head) parts.push(formatRow(idx, row));
      if (tail.length) {
        parts.push("尾部非空行：");
        for (const { row, idx } of tail) parts.push(formatRow(idx, row));
      }
      // 只详细展示第一个 sheet，其余 sheet 给出结构提示
      if (sheet.index >= 2) break;
    }
    if (doc.sheets.length > 1) {
      parts.push(`\n注意：该文件含 ${doc.sheets.length} 个工作表，名称依次为：${doc.sheets.map((s) => s.name).join("、")}。若各表结构相同，规则应遍历所有 Sheet。`);
    }
  } else {
    const lines = doc.text?.lines || [];
    parts.push(`文本行数：${lines.length}`);
    const head = lines.slice(0, maxRows + 6);
    const tail = lines.slice(-8).filter((l) => !head.includes(l));
    parts.push("前部文本行：");
    head.forEach((l, i) => parts.push(`L${i}: ${truncate(l)}`));
    if (tail.length) {
      parts.push("尾部文本行：");
      tail.forEach((l) => parts.push(`… ${truncate(l)}`));
    }
  }

  return parts.join("\n");
}

function formatRow(idx: number, row: (string | number | boolean | null)[]): string {
  const cells = row
    .map((v, c) => (String(v ?? "").trim() === "" ? null : `[${c}]${truncate(String(v), 30)}`))
    .filter(Boolean)
    .slice(0, 16);
  return `R${idx + 1}: ${cells.join(" ")}`;
}

function truncate(s: string, max = 60): string {
  const t = s.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  return t.length > max ? t.slice(0, max) + "…" : t;
}
