// V4 压测数据准备：20,000 条 SKU 主数据 + 10,000 行压测 Excel + 压测解析规则。
// 可重复执行：先清理 SKU_% 主数据与压测规则，再重建；不产生不可控脏数据。
// 用法：node --experimental-strip-types scripts/seed-data.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
  try {
    const txt = readFileSync(resolve(root, ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}
loadEnv();
const sql = neon(process.env.DATABASE_URL);

// 可复现随机数
let seed = 42;
const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const ri = (n) => Math.floor(rnd() * n);

const SKU_N = 20000;
const ROW_N = 10000;

async function applySchema() {
  const schema = readFileSync(resolve(root, "db", "schema-v4.sql"), "utf8");
  const noComments = schema.split(/\r?\n/).filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const stmt of noComments.split(";").map((s) => s.trim()).filter(Boolean)) {
    try { await sql.query(stmt, []); } catch { /* 已存在 */ }
  }
  console.log("✓ schema-v4 已应用");
}

async function seedSku() {
  await sql.query(`DELETE FROM sku_master WHERE sku_code LIKE 'SKU_%'`, []);
  const units = ["件", "包", "箱", "桶", "瓶"];
  for (let s = 1; s <= SKU_N; s += 2000) {
    const vals = []; const params = [];
    for (let i = s; i < Math.min(s + 2000, SKU_N + 1); i++) {
      const code = `SKU_${String(i).padStart(5, "0")}`;
      params.push(code, `压测商品${i}号`, `规格${i % 50}g`, units[i % units.length]);
      const o = params.length - 3;
      vals.push(`($${o},$${o + 1},$${o + 2},$${o + 3})`);
    }
    await sql.query(`INSERT INTO sku_master (sku_code,name,spec,unit) VALUES ${vals.join(",")} ON CONFLICT (sku_code) DO NOTHING`, params);
  }
  const c = await sql`SELECT COUNT(*)::int n FROM sku_master`;
  console.log("✓ SKU 主数据：", c[0].n);
}

function genExcel() {
  const header = ["外部编码", "收货门店", "收件人姓名", "收件人电话", "收件人地址", "SKU编码", "SKU名称", "发货数量", "规格型号", "备注"];
  const rows = [header];
  for (let r = 1; r <= ROW_N; r++) {
    const skuIdx = ri(SKU_N) + 1;
    const skuCode = `SKU_${String(skuIdx).padStart(5, "0")}`;
    let row = [
      `EXT_${String(Math.floor(r / 5)).padStart(6, "0")}`,
      `压测门店${(r % 20) + 1}号`,
      "", "", "",
      skuCode, `压测商品${skuIdx}号`, 1 + ri(20), `规格${skuIdx % 50}g`, "",
    ];
    // B 组收件人（部分行）或 A 组门店
    if (r % 3 === 0) { row[2] = `收件人${r}`; row[3] = `138${String(10000000 + ri(89999999))}`; row[4] = `压测地址${r}号`; row[1] = ""; }
    // 注入非法数据
    const bad = r % 97;
    if (bad === 1) row[5] = `SKU_9${String(skuIdx).padStart(5, "0")}`;      // E001 不存在
    if (bad === 2) row[6] = "";                                              // E002 必填缺失
    if (bad === 3) row[3] = "12ab";                                          // E003 电话错误
    if (bad === 4) row[7] = 0;                                               // E004 数量非正
    if (bad === 5 && r > 10) { row[0] = rows[r - 10][0]; row[5] = rows[r - 10][5]; } // E005 重复
    rows.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "orders");
  const dir = resolve(root, "test-data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = resolve(dir, "10000-orders.xlsx");
  XLSX.writeFile(wb, out);
  console.log("✓ 压测文件：", out, `（${ROW_N} 行）`);
}

async function seedRule() {
  const name = "压测标准出库单（V4）";
  const exist = await sql.query(`SELECT id FROM parse_rules WHERE name=$1`, [name]);
  if (exist.length) { console.log("✓ 压测规则已存在 id=", exist[0].id); return exist[0].id; }
  const spec = {
    layout: { type: "table", headerLocate: { matchText: "SKU编码" }, dataRange: { start: "afterHeader" }, itemFieldsInRow: true },
    fields: [
      { target: "externalCode", source: { kind: "column", headerMatch: "外部编码" } },
      { target: "store", source: { kind: "column", headerMatch: "收货门店" } },
      { target: "receiverName", source: { kind: "column", headerMatch: "收件人姓名" } },
      { target: "receiverPhone", source: { kind: "column", headerMatch: "收件人电话" }, transform: "phoneNormalize" },
      { target: "receiverAddress", source: { kind: "column", headerMatch: "收件人地址" } },
      { target: "skuCode", source: { kind: "column", headerMatch: "SKU编码" } },
      { target: "skuName", source: { kind: "column", headerMatch: "SKU名称" } },
      { target: "skuQty", source: { kind: "column", headerMatch: "发货数量" }, transform: "toNumber" },
      { target: "skuSpec", source: { kind: "column", headerMatch: "规格型号" } },
      { target: "remark", source: { kind: "column", headerMatch: "备注" } },
    ],
  };
  const ins = await sql.query(`INSERT INTO parse_rules (name,description,file_type,spec,source) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id`, [name, "V4 压测 10,000 行标准出库单", "excel", JSON.stringify(spec), "manual"]);
  console.log("✓ 压测规则已创建 id=", ins[0].id);
  return ins[0].id;
}

async function main() {
  await applySchema();
  await seedSku();
  genExcel();
  await seedRule();
  console.log("✓ 压测数据准备完成");
}
main().catch((e) => { console.error("✗ seed 失败：", e); process.exit(1); });
