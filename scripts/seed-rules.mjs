// 将预置规则灌入 Neon（幂等：先清空 parse_rules 再插入）。
// 用法：node --experimental-strip-types scripts/seed-rules.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

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
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ 缺少 DATABASE_URL");
  process.exit(1);
}
const sql = neon(url);

const { PRESET_RULES } = await import("../lib/presets.ts");

await sql.query("DELETE FROM parse_rules", []);
console.log("✓ 已清空 parse_rules");

for (const r of PRESET_RULES) {
  await sql.query(
    `INSERT INTO parse_rules (name, description, file_type, spec, field_meta, source)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6)`,
    [r.name, r.description || null, r.fileType, JSON.stringify(r.spec), JSON.stringify(r.fieldMeta || {}), r.source || "manual"]
  );
  console.log("✓ 插入规则：", r.name);
}
const rows = await sql`SELECT COUNT(*)::int AS n FROM parse_rules`;
console.log("✓ 完成，当前规则数：", rows[0].n);
