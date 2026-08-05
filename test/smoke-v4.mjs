// V4 管道冒烟测试：生成小文件 → 上传 → 轮询至完成 → 打印状态/错误。
// 用法：node --experimental-strip-types test/smoke-v4.mjs
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const BASE = process.env.BASE || "http://localhost:3000";

function genSmall() {
  const header = ["外部编码","收货门店","收件人姓名","收件人电话","收件人地址","SKU编码","SKU名称","发货数量","规格型号","备注"];
  const rows = [header];
  for (let i = 1; i <= 30; i++) {
    rows.push([`EXT_S${i}`, `门店${i%3}`, "", "", "", `SKU_${String(i).padStart(5,"0")}`, `商品${i}`, i, "规格", ""]);
  }
  // 注入 2 个错误行
  rows.push(["EXT_BAD1","门店1","","","","SKU_99999","不存在",1,"",""]);   // E001
  rows.push(["EXT_BAD2","门店1","","","","SKU_00001","",1,"",""]);        // E002 缺名称
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "o");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function main() {
  const buf = genSmall();
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/octet-stream" }), "smoke.xlsx");
  fd.append("ruleId", "7");

  const t0 = Date.now();
  const up = await fetch(`${BASE}/api/import-tasks`, { method: "POST", body: fd });
  const upJson = await up.json();
  const upMs = Date.now() - t0;
  console.log("上传响应(ms):", upMs, JSON.stringify(upJson.data || upJson));
  if (!up.ok) { console.error("上传失败"); process.exit(1); }
  const taskId = upJson.data.task_id;

  // 轮询
  let last = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const g = await fetch(`${BASE}/api/import-tasks/${taskId}`);
    last = (await g.json()).data;
    if (["COMPLETED","PARTIAL_SUCCESS","FAILED"].includes(last.status)) break;
  }
  console.log("最终状态:", JSON.stringify(last, null, 1));

  const er = await fetch(`${BASE}/api/import-tasks/${taskId}/errors?page_size=50`);
  const errs = (await er.json()).data;
  console.log("错误数:", errs.total);
  for (const e of errs.items.slice(0, 10)) console.log(`  行${e.row_number} [${e.error_code}] ${e.field_name}=${e.raw_value} ${e.error_reason}`);

  const tr = await fetch(`${BASE}/api/traces/${last.trace_id}`);
  const tl = (await tr.json()).data;
  console.log("trace 事件数:", tl.events.length);
  tl.events.slice(0, 12).forEach((e) => console.log(`  ${new Date(e.occurred_at).toISOString().slice(11,19)} ${e.event_name} ${e.message||""}`));
}
main().catch((e) => { console.error("smoke 失败:", e); process.exit(1); });
