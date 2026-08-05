// 一次性初始化脚本：连接 Neon，执行 db/schema.sql 建表，并做连通性测试。
// 用法：node scripts/setup-db.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// 读取 .env.local 中的 DATABASE_URL
function loadEnv() {
  try {
    const txt = readFileSync(resolve(root, ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* ignore */
  }
}

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ 未找到 DATABASE_URL（请确认 .env.local）");
  process.exit(1);
}

const sql = neon(url);

async function main() {
  // 连通性
  const ping = await sql`SELECT 1 AS ok`;
  console.log("✓ Neon 连通成功：", JSON.stringify(ping));

  // 执行建表脚本：先整体去掉 -- 注释行，再按分号拆分
  const schema = readFileSync(resolve(root, "db", "schema.sql"), "utf8");
  const noComments = schema
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  const statements = noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const cleaned of statements) {
    try {
      await sql.query(cleaned, []);
      const first = cleaned.split(/\r?\n/).find((l) => l.trim()) || "";
      console.log("✓ 执行成功：", first.trim().slice(0, 60));
    } catch (e) {
      console.warn("✗ 语句失败（可能已存在）：", e instanceof Error ? e.message : e);
    }
  }

  // 校验表
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`;
  console.log("✓ 当前数据表：", tables.map((t) => t.table_name).join(", "));
}

main().catch((e) => {
  console.error("✗ 初始化失败：", e);
  process.exit(1);
});
