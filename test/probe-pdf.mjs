import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// 用 legacy 构建（Node 友好）
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const workerPath = resolve(root, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
if (existsSync(workerPath)) {
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}

const file = "E:\\IntelijWorkSpace\\AiWorkSpace\\demos\\黔寨寨贵州烙锅（鞍山店）常温.pdf";
const data = new Uint8Array(readFileSync(file));
const doc = await pdfjs.getDocument({ data, useWorkerFetch: false }).promise;
console.log("pages:", doc.numPages);

const lines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  const items = content.items.filter((it) => typeof it.str === "string");
  const sorted = [...items].sort((a, b) => {
    const dy = b.transform[5] - a.transform[5];
    if (Math.abs(dy) > 2) return dy;
    return a.transform[4] - b.transform[4];
  });
  let curY = null, cur = [];
  const flush = () => {
    if (cur.length) {
      const t = cur.sort((a, b) => a.transform[4] - b.transform[4]).map((x) => x.str).join("\t").replace(/\t+/g, "\t").trim();
      if (t) lines.push(t);
    }
    cur = [];
  };
  for (const it of sorted) {
    const y = it.transform[5];
    if (curY === null || Math.abs(y - curY) <= 2) { cur.push(it); if (curY === null) curY = y; }
    else { flush(); cur = [it]; curY = y; }
  }
  flush();
}
if (typeof doc.destroy === "function") await doc.destroy();

console.log("total lines:", lines.length);
lines.forEach((l, i) => console.log(`L${i}: ${l.replace(/\t/g, " | ").slice(0, 110)}`));
