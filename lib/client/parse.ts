"use client";
import type { NormalizedDocument } from "../ir/types";
import type { ParseRule, ParseResult } from "../engine/types";
import { normalizeExcel } from "../ir/excel";
import { normalizeWord } from "../ir/word";
import { normalizePdf } from "../ir/pdf";
import { executeRule } from "../engine/executor";
import { summarizeIR } from "../ai/schema";

export function detectKind(name: string): "excel" | "word" | "pdf" | null {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "excel";
  if (n.endsWith(".docx")) return "word";
  if (n.endsWith(".pdf")) return "pdf";
  return null;
}

/** 将上传文件归一化为 IR（浏览器端执行） */
export async function normalizeFile(file: File): Promise<NormalizedDocument> {
  const kind = detectKind(file.name);
  if (!kind) throw new Error("不支持的文件格式，请上传 .xlsx / .xls / .docx / .pdf 文件");
  const buf = await file.arrayBuffer();
  if (buf.byteLength === 0) throw new Error("文件为空");
  if (kind === "excel") return normalizeExcel(new Uint8Array(buf), file.name);
  if (kind === "word") return normalizeWord(buf, file.name);
  return normalizePdf(buf, file.name);
}

/** 执行规则解析 */
export function runParse(doc: NormalizedDocument, rule: ParseRule): ParseResult {
  return executeRule(doc, rule);
}

/** 生成结构摘要（供 AI 规则生成） */
export function summarize(doc: NormalizedDocument): string {
  return summarizeIR(doc);
}
