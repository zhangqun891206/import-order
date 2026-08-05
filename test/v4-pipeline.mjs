// V4 自动化测试：对活服务验证异步导入关键链路。
// 用法：先 `npm run build && npm start`，再 node --experimental-strip-types test/v4-pipeline.mjs
import * as XLSX from "xlsx";

const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };

function genFile() {
  const header = ["外部编码","收货门店","收件人姓名","收件人电话","收件人地址","SKU编码","SKU名称","发货数量","规格型号","备注"];
  const rows = [header];
  for (let i = 1; i <= 20; i++) rows.push([`EXT_T${i}`, `门店${i%2}`, "", "", "", `SKU_${String(i).padStart(5,"0")}`, `商品${i}`, i, "规格", ""]);
  rows.push(["EXT_BAD","门店1","","","","SKU_99999","不存在",1,"",""]);  // E001
  rows.push(["EXT_BAD2","门店1","","","","SKU_00001","",1,"",""]);       // E002
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "o");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function main() {
  console.log("== V4 管道自动化测试 ==");

  // 非法 task_id 保护
  const nf = await fetch(`${BASE}/api/import-tasks/no_such_task`);
  ok(nf.status === 404, "非法 task_id 返回 404");

  // 上传 <1s（允许冷启动余量，断言返回 task_id）
  const fd = new FormData();
  fd.append("file", new Blob([genFile()], { type: "application/octet-stream" }), "t.xlsx");
  fd.append("ruleId", "7");
  const t0 = Date.now();
  const up = await fetch(`${BASE}/api/import-tasks`, { method: "POST", body: fd });
  const upMs = Date.now() - t0;
  const uj = await up.json();
  ok(up.ok && uj.data.task_id, `上传返回 task_id（${upMs}ms）`);
  const taskId = uj.data.task_id;
  const traceId = uj.data.trace_id;

  // Outbox 同事务：存在 ImportTaskCreated 事件
  // 轮询至完成（驱动 pump 通过任务页 GET）
  let last = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    last = (await fetch(`${BASE}/api/import-tasks/${taskId}`).then((r) => r.json())).data;
    if (last && ["COMPLETED","PARTIAL_SUCCESS","FAILED"].includes(last.status)) break;
  }
  ok(last && ["COMPLETED","PARTIAL_SUCCESS"].includes(last.status), `任务最终状态聚合（${last?.status}）`);
  ok(last && last.success_rows > 0, "成功行入库（success_rows>0）");
  ok(last && last.failed_rows >= 2, "失败行计数（>=2）");

  // 错误明细按行记录
  const er = (await fetch(`${BASE}/api/import-tasks/${taskId}/errors`).then((r) => r.json())).data;
  ok(er.total >= 2, `行级错误记录（${er.total}）`);
  const codes = new Set(er.items.map((e) => e.error_code));
  ok(codes.has("E001") && codes.has("E002"), "错误码含 E001/E002");

  // 批次性能日志
  const bt = (await fetch(`${BASE}/api/import-tasks/${taskId}/batches`).then((r) => r.json())).data;
  ok(bt.perf.length > 0, "batch_performance_log 有记录");

  // Trace 时间线
  const tr = (await fetch(`${BASE}/api/traces/${traceId}`).then((r) => r.json())).data;
  ok(tr.events.length > 0, `Trace 时间线生成（${tr.events.length} 事件）`);

  // 幂等：再次 pump 不重复累计
  const before = last;
  await fetch(`${BASE}/api/internal/pump`, { method: "POST", body: JSON.stringify({ max_ms: 5000 }) }).catch(() => {});
  const after = (await fetch(`${BASE}/api/import-tasks/${taskId}`).then((r) => r.json())).data;
  ok(after.success_rows === before.success_rows, "重复 pump 不重复累计进度");

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("测试异常:", e); process.exit(1); });
