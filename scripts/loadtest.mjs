// V4 压测脚本：上传 10,000 行 Excel → 进程内常驻 Worker 消费 → 轮询至完成 → 统计 → 判定 ≤60s。
// 用法：node --experimental-strip-types scripts/loadtest.mjs
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// 载入 .env.local（供 lib/v4/worker 直连数据库）
try {
  const txt = readFileSync(resolve(root, ".env.local"), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const BASE = process.env.BASE || "http://localhost:3000";
const FILE = process.env.FILE || resolve(root, "test-data", "10000-orders.xlsx");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const bytes = readFileSync(FILE);
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "application/octet-stream" }), "10000-orders.xlsx");
  fd.append("ruleId", process.env.RULE_ID || "7");

  // 1 上传（计时）
  const t0 = Date.now();
  const up = await fetch(`${BASE}/api/import-tasks`, { method: "POST", body: fd });
  const upMs = Date.now() - t0;
  if (!up.ok) { console.error("上传失败 HTTP", up.status); process.exit(1); }
  const taskId = (await up.json()).data.task_id;
  console.log(`上传响应: ${upMs}ms  task=${taskId}`);

  // 2 常驻 Worker：循环调用 internal/pump（服务端进程内消费），并发 2
  let done = false;
  const workerCount = Number(process.env.WORKERS || 2);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!done) {
      try {
        await fetch(`${BASE}/api/internal/pump`, { method: "POST", body: JSON.stringify({ max_ms: 30000 }) });
      } catch {}
      await sleep(300);
    }
  });

  // 3 轮询状态
  let last = null;
  const start = Date.now();
  let httpErr = 0;
  for (;;) {
    await sleep(1000);
    try {
      const g = await fetch(`${BASE}/api/import-tasks/${taskId}`);
      if (g.status >= 500) httpErr++;
      last = (await g.json()).data;
    } catch { httpErr++; }
    const el = (Date.now() - start) / 1000;
    process.stdout.write(`\r  t=${el.toFixed(1)}s 状态=${last?.status} 已处理=${last?.processed_rows}/${last?.total_rows} 成功=${last?.success_rows} 失败=${last?.failed_rows}   `);
    if (last && ["COMPLETED", "PARTIAL_SUCCESS", "FAILED"].includes(last.status)) break;
    if (el > 120) { console.log("\n超时 120s"); break; }
  }
  done = true;
  await Promise.race([Promise.all(workers), sleep(3000)]);
  const totalSec = (Date.now() - start) / 1000;
  console.log("\n");

  // 4 批次性能
  const b = await fetch(`${BASE}/api/import-tasks/${taskId}/batches`).then((r) => r.json());
  const perf = (b.data?.perf || []).filter((p) => p.batch_index > 0);
  const pick = (arr, q) => { const s = [...arr].filter((x) => x != null).sort((a, c) => a - c); return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0; };
  const summary = {
    test_time: new Date().toISOString(),
    workers: workerCount,
    upload_ms: upMs,
    total_seconds: +totalSec.toFixed(1),
    total_rows: last?.total_rows, success_rows: last?.success_rows, failed_rows: last?.failed_rows,
    status: last?.status, degraded: last?.degraded,
    batch_p50_ms: pick(perf.map((p) => p.total_duration_ms), 0.5),
    batch_p95_ms: pick(perf.map((p) => p.total_duration_ms), 0.95),
    validate_p95_ms: pick(perf.map((p) => p.validate_duration_ms), 0.95),
    insert_p95_ms: pick(perf.map((p) => p.insert_duration_ms), 0.95),
    http_5xx: httpErr,
    meet_60s: totalSec <= 60,
  };
  console.log("===== 压测结果 =====");
  console.log(JSON.stringify(summary, null, 2));
  console.log(summary.meet_60s ? "✓ 达到 ≤60s 目标" : "✗ 未达 ≤60s 目标");
  process.exit(0);
}
main().catch((e) => { console.error("loadtest 失败:", e); process.exit(1); });
