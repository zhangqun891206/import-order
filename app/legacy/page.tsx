"use client";
import dynamic from "next/dynamic";

// V2 同步导入（小文件场景保留），主链路已切换为异步事件驱动（见首页）
const ImportFlow = dynamic(() => import("@/components/ImportFlow"), {
  ssr: false,
  loading: () => <div className="card p-10 text-center text-ink-3 text-sm">加载中…</div>,
});

export default function LegacyPage() {
  return <ImportFlow />;
}
