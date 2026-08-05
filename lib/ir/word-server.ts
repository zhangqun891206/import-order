import JSZip from "jszip";
import type { NormalizedDocument } from "./types";

/**
 * 服务端（Node）Word 归一化：无 DOMParser，用正则抽取段落文本。
 * 与浏览器端 lib/ir/word.ts 产出相同 IR 结构。
 */
export async function normalizeWordServer(buf: ArrayBuffer | Uint8Array, fileName: string): Promise<NormalizedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const docXml = zip.file("word/document.xml");
  if (!docXml) throw new Error("无法读取 Word 文档内容（缺少 word/document.xml）");
  const xml = await docXml.async("string");

  const lines: string[] = [];
  // 按段落 <w:p ...>...</w:p> 切分
  const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    const block = m[0];
    let text = "";
    const nodeRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/?>|<w:br\s*\/?>/g;
    let nm: RegExpExecArray | null;
    while ((nm = nodeRe.exec(block)) !== null) {
      if (nm[0].startsWith("<w:t")) text += decodeXml(nm[1] ?? "");
      else if (nm[0].startsWith("<w:tab")) text += "\t";
      else text += "\n";
    }
    const t = text.replace(/\s+$/, "");
    if (t.trim() !== "") lines.push(t);
  }

  return { fileName, fileKind: "word", sheets: [], text: { lines } };
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
