// 引擎自测：用 demos 目录的真实样例验证「IR 归一化 + 规则执行」。
// 用法：node --experimental-strip-types test/run-engine.mjs
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const demos = "E:\\IntelijWorkSpace\\AiWorkSpace\\demos";

const { normalizeExcel } = await import("../lib/ir/excel.ts");
const { executeRule } = await import("../lib/engine/executor.ts");

// ---------------- 6 份样例的规则配置 ----------------
const RULES = {
  "黎明屯": {
    name: "黎明屯配送发货单",
    fileType: "excel",
    spec: {
      sheet: { mode: "first" },
      layout: {
        type: "table",
        headerLocate: { rowIndex: 3 },
        dataRange: { start: "afterHeader", end: { untilText: "合计" } },
        itemFieldsInRow: true,
      },
      fields: [
        { target: "externalCode", source: { kind: "labelValue", label: "单据号", scope: "sheet" } },
        { target: "store", source: { kind: "labelValue", label: "收货机构", scope: "sheet" } },
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格型号" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "发货数量" }, transform: "toNumber" },
        { target: "receiverName", source: { kind: "labelValue", label: "收货人", scope: "sheet" } },
        { target: "receiverPhone", source: { kind: "labelValue", label: "收货电话", scope: "sheet" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "labelValue", label: "收货地址", scope: "sheet" } },
      ],
      skip: [{ when: { cellContains: "合计" }, scope: "row" }],
    },
    expect: { waybills: 1, items: 2 },
  },

  "湖南仓": {
    name: "湖南仓发货明细",
    fileType: "excel",
    spec: {
      sheet: { mode: "first" },
      layout: { type: "table", headerLocate: { rowIndex: 1 }, dataRange: { start: "afterHeader" }, itemFieldsInRow: true },
      fields: [
        { target: "externalCode", source: { kind: "column", headerMatch: "配送单号" } },
        { target: "store", source: { kind: "column", headerMatch: "收货机构" } },
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格型号" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "发货数量" }, transform: "toNumber" },
        { target: "receiverName", source: { kind: "column", headerMatch: "收货人" } },
        { target: "receiverPhone", source: { kind: "column", headerMatch: "收货电话" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "column", headerMatch: "收货地址" } },
      ],
      groupBy: { by: "externalCode" },
    },
    expect: { waybillsMin: 2, itemsMin: 100 },
  },

  "欢乐牧场": {
    name: "欢乐牧场SKU×门店矩阵",
    fileType: "excel",
    spec: {
      sheet: { mode: "first" },
      layout: {
        type: "matrix",
        rowEntity: { headerRowIndex: 0, labelCols: [2, 3, 4, 7] },
        colEntity: { headerRowIndex: 0, colRange: [13, 17] },
        value: { skipEmptyOrZero: true },
        expandTo: "records",
        valueTarget: "skuQty",
        colHeaderTarget: "store",
      },
      fields: [
        { target: "skuCode", source: { kind: "column", headerMatch: "SKU条码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "SKU名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格" } },
      ],
      groupBy: { by: "store" },
    },
    expect: { waybills: 5, itemsMin: 10 },
  },

  "多门店": {
    name: "多门店分Sheet出库单",
    fileType: "excel",
    spec: {
      sheet: { mode: "all" },
      layout: {
        type: "table",
        headerLocate: { matchText: "出库数量" },
        dataRange: { start: "afterHeader", end: { untilText: "合计" } },
        itemFieldsInRow: true,
      },
      fields: [
        { target: "store", source: { kind: "labelValue", label: "收货门店", scope: "sheet" } },
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格型号" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "出库数量" }, transform: "toNumber" },
        { target: "remark", source: { kind: "column", headerMatch: "备注" } },
        { target: "receiverName", source: { kind: "labelValue", label: "联系人", scope: "sheet" } },
        { target: "receiverPhone", source: { kind: "labelValue", label: "联系电话", scope: "sheet" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "labelValue", label: "收货地址", scope: "sheet" } },
      ],
      skip: [{ when: { cellContains: "合计" }, scope: "row" }],
    },
    expect: { waybills: 3, items: 21 },
  },

  "卡片": {
    name: "门店调拨单卡片式",
    fileType: "excel",
    spec: {
      sheet: { mode: "first" },
      layout: {
        type: "card",
        marker: { matchText: "调拨记录" },
        inner: {
          labels: [
            { label: "调入门店", target: "store" },
            { label: "收货人", target: "receiverName" },
            { label: "电话", target: "receiverPhone" },
            { label: "收货地址", target: "receiverAddress" },
          ],
          table: {
            type: "table",
            headerLocate: { matchText: "物品编码" },
            dataRange: { start: "afterHeader" },
            itemFieldsInRow: true,
          },
        },
      },
      fields: [
        { target: "skuCode", source: { kind: "column", headerMatch: "物品编码" } },
        { target: "skuName", source: { kind: "column", headerMatch: "物品名称" } },
        { target: "skuSpec", source: { kind: "column", headerMatch: "规格" } },
        { target: "skuQty", source: { kind: "column", headerMatch: "数量" }, transform: "toNumber" },
      ],
      skip: [{ when: { cellContains: "合计" }, scope: "row" }],
    },
    expect: { waybillsMin: 3, itemsMin: 8 },
  },
};

// ---------------- 文件名 → 规则键 映射（仅测试用，产品中由用户手动选择规则） ----------------
function pickRuleKey(file) {
  if (file.includes("黎明屯") || file.includes("海口龙湖")) return "黎明屯";
  if (file.includes("湖南仓")) return "湖南仓";
  if (file.includes("欢乐牧场")) return "欢乐牧场";
  if (file.includes("多门店")) return "多门店";
  if (file.includes("卡片")) return "卡片";
  return null;
}

const files = readdirSync(demos).filter((f) => /\.(xlsx|xls)$/i.test(f));
let pass = 0, fail = 0;

for (const f of files) {
  const key = pickRuleKey(f);
  if (!key) {
    console.log(`\n[跳过] ${f}（无对应测试规则）`);
    continue;
  }
  const buf = readFileSync(resolve(demos, f));
  const doc = normalizeExcel(new Uint8Array(buf), f);
  const rule = RULES[key];
  const result = executeRule(doc, rule);
  const wb = result.waybills.length;
  const items = result.waybills.reduce((s, w) => s + w.items.length, 0);
  const exp = rule.expect;
  let ok = true;
  if (exp.waybills !== undefined && wb !== exp.waybills) ok = false;
  if (exp.items !== undefined && items !== exp.items) ok = false;
  if (exp.waybillsMin !== undefined && wb < exp.waybillsMin) ok = false;
  if (exp.itemsMin !== undefined && items < exp.itemsMin) ok = false;

  console.log(`\n[${ok ? "通过" : "失败"}] ${key} ← ${f}`);
  console.log(`   运单=${wb} 物品行=${items} 警告=${result.warnings.length ? result.warnings.join(";") : "无"}`);
  const first = result.waybills[0];
  if (first) {
    console.log(`   首单: ${first.receiverMode}组 收货=${first.store || first.receiverName || "-"} 电话=${first.receiverPhone || "-"} 物品=${first.items.length}`);
    const it = first.items[0];
    if (it) console.log(`   首物品: ${it.skuCode} ${it.skuName} ×${it.qty} ${it.spec || ""}`);
  }
  if (ok) pass++; else fail++;
}

console.log(`\n===== Excel 汇总：通过 ${pass} / 失败 ${fail} =====`);

// ---------------- PDF 样例（黔寨寨） ----------------
{
  const { pathToFileURL } = await import("node:url");
  const { existsSync } = await import("node:fs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerPath = resolve(__dirname, "..", "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs");
  if (existsSync(workerPath)) pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const pdfFile = resolve(demos, "黔寨寨贵州烙锅（鞍山店）常温.pdf");
  const data = new Uint8Array(readFileSync(pdfFile));
  const doc = await pdfjs.getDocument({ data, useWorkerFetch: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter((it) => typeof it.str === "string" && it.str.trim() !== "");
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

  const normalized = { fileName: "黔寨寨.pdf", fileKind: "pdf", sheets: [], text: { lines } };
  const pdfRule = {
    name: "黔寨寨配送单PDF",
    fileType: "pdf",
    spec: {
      layout: {
        type: "text",
        itemLine: { regex: "(ZBWP\\d+)\\t([^\\t]+).*\\t(\\d+)\\s*$", groups: { skuCode: 1, skuName: 2, skuQty: 3 } },
      },
      fields: [
        { target: "externalCode", source: { kind: "labelValue", label: "单据编号", scope: "doc" } },
        { target: "store", source: { kind: "labelValue", label: "收货机构", scope: "doc" } },
        { target: "receiverName", source: { kind: "labelValue", label: "收货人", scope: "doc" } },
        { target: "receiverPhone", source: { kind: "labelValue", label: "收货电话", scope: "doc" }, transform: "phoneNormalize" },
        { target: "receiverAddress", source: { kind: "labelValue", label: "收货地址", scope: "doc" } },
      ],
    },
  };
  const result = executeRule(normalized, pdfRule);
  const wb = result.waybills.length;
  const itemCount = result.waybills.reduce((s, w) => s + w.items.length, 0);
  const ok = wb === 1 && itemCount >= 40;
  console.log(`\n[${ok ? "通过" : "失败"}] 黔寨寨PDF`);
  console.log(`   运单=${wb} 物品行=${itemCount}`);
  const first = result.waybills[0];
  if (first) {
    console.log(`   收货=${first.store || "-"} 电话=${first.receiverPhone || "-"} 地址=${(first.receiverAddress || "").slice(0, 24)}`);
    const it = first.items[0];
    if (it) console.log(`   首物品: ${it.skuCode} ${it.skuName} ×${it.qty}`);
  }
  if (ok) pass++; else fail++;
  console.log(`\n===== 总汇总（含PDF）：通过 ${pass} / 失败 ${fail} =====`);
}
