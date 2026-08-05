import JSZip from "jszip";
import type { NormalizedDocument } from "./types";

/**
 * 将 Word(.docx) 文件归一化为 IR。
 * docx 本质是 zip + XML，直接解包 word/document.xml 抽取段落文本，
 * 避免引入重型解析库。
 */
export async function normalizeWord(buf: ArrayBuffer, fileName: string): Promise<NormalizedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const docXml = zip.file("word/document.xml");
  if (!docXml) {
    throw new Error("无法读取 Word 文档内容（缺少 word/document.xml）");
  }
  const xmlText = await docXml.async("string");
  const lines = extractParagraphs(xmlText);
  return {
    fileName,
    fileKind: "word",
    sheets: [],
    text: { lines },
  };
}

/** 从 document.xml 抽取段落文本（保留制表符/换行语义）。 */
function extractParagraphs(xml: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagName("w:p"));
  const result: string[] = [];

  for (const p of paragraphs) {
    let text = "";
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as Element).tagName;
        if (tag === "w:tab") text += "\t";
        else if (tag === "w:br") text += "\n";
      }
      node = walker.nextNode();
    }
    result.push(text.replace(/\s+$/, ""));
  }

  // 去掉首尾连续空段
  while (result.length && result[0].trim() === "") result.shift();
  while (result.length && result[result.length - 1].trim() === "") result.pop();
  return result;
}
