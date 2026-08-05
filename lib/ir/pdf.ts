import type { NormalizedDocument } from "./types";

// pdfjs-dist 依赖浏览器 API（DOMMatrix 等），不能在构建期/服务端被求值。
// 因此用「函数内动态 import」，只在浏览器运行时才加载，避免 prerender 报错。

interface PdfTextItem {
  str: string;
  transform: number[]; // [a,b,c,d,e,f]，e=x，f=y
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
      } catch {
        // 回退：pdfjs 使用 fake worker（主线程）
      }
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * 将 PDF 归一化为 IR：按 y 坐标把文本项重组成行，保留阅读顺序。
 * PDF 坐标系 y 向上增大，因此按 y 降序、x 升序排列。
 */
export async function normalizePdf(buf: ArrayBuffer, fileName: string): Promise<NormalizedDocument> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: { index: number; lines: string[] }[] = [];
  const allLines: string[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as unknown as PdfTextItem[]).filter(
      (it) => typeof it.str === "string" && it.str.trim() !== ""
    );

    // 按 y 分行：y 相近（容差 2）归为同一行
    const sorted = [...items].sort((a, b) => {
      const dy = b.transform[5] - a.transform[5];
      if (Math.abs(dy) > 2) return dy;
      return a.transform[4] - b.transform[4];
    });

    const lines: string[] = [];
    let currentY: number | null = null;
    let currentLine: PdfTextItem[] = [];

    const flush = () => {
      if (currentLine.length) {
        const text = currentLine
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((it) => it.str)
          .join("\t")
          .replace(/\t+/g, "\t")
          .trim();
        if (text) lines.push(text);
      }
      currentLine = [];
    };

    for (const it of sorted) {
      const y = it.transform[5];
      if (currentY === null || Math.abs(y - currentY) <= 2) {
        currentLine.push(it);
        currentY = currentY === null ? y : currentY;
      } else {
        flush();
        currentLine = [it];
        currentY = y;
      }
    }
    flush();

    pages.push({ index: p, lines });
    allLines.push(...lines);
  }

  const destroyable = doc as unknown as { destroy?: () => Promise<void> };
  if (typeof destroyable.destroy === "function") await destroyable.destroy();
  return { fileName, fileKind: "pdf", sheets: [], text: { lines: allLines, pages } };
}
