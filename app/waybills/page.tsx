"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface WaybillItem {
  id: number;
  externalCode: string | null;
  receiverMode: string;
  storeName: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
  receiverAddress: string | null;
  itemCount: number;
  createdAt: string;
}

interface ListData {
  items: WaybillItem[];
  total: number;
  page: number;
  pageSize: number;
}

export default function WaybillsPage() {
  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [externalCode, setExternalCode] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (externalCode) sp.set("externalCode", externalCode);
      if (receiverName) sp.set("receiverName", receiverName);
      if (startDate) sp.set("startDate", startDate);
      if (endDate) sp.set("endDate", endDate);
      const resp = await fetch(`/api/waybills?${sp.toString()}`);
      const json = await resp.json();
      if (!json.ok) throw new Error(json.error);
      setData(json.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [externalCode, receiverName, startDate, endDate]);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div className="fade-in space-y-4">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-ink mb-1">已导入运单</h2>
        <p className="text-sm text-ink-3 mb-4">历史已提交运单，支持按外部编码、收件人、提交时间筛选。</p>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input className="input" placeholder="外部编码" value={externalCode} onChange={(e) => setExternalCode(e.target.value)} />
          <input className="input" placeholder="收件人/门店姓名" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <button className="btn btn-primary" onClick={() => { setPage(1); load(1); }}>查询</button>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-ink-3 text-sm">加载中…</div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-10 text-center text-ink-3 text-sm">暂无运单数据。</div>
        ) : (
          <>
            <div className="table-wrap !border-0 !rounded-none">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>外部编码</th>
                    <th>收货方式</th>
                    <th>收货门店/收件人</th>
                    <th>电话</th>
                    <th>地址</th>
                    <th>物品行数</th>
                    <th>提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((w) => (
                    <tr key={w.id}>
                      <td className="font-medium text-ink">{w.externalCode || "—"}</td>
                      <td><span className={`tag ${w.receiverMode === "A" ? "" : "tag-warn"}`}>{w.receiverMode === "A" ? "门店" : "收件人"}</span></td>
                      <td>{w.storeName || w.receiverName || "—"}</td>
                      <td>{w.receiverPhone || "—"}</td>
                      <td className="max-w-[220px] truncate" title={w.receiverAddress || ""}>{w.receiverAddress || "—"}</td>
                      <td>{w.itemCount}</td>
                      <td className="text-xs">{new Date(w.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-line">
              <span className="text-sm text-ink-3">共 {data.total} 条 · 第 {data.page}/{totalPages} 页</span>
              <div className="flex gap-2">
                <button className="btn btn-outline !py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
                <button className="btn btn-outline !py-1.5" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
