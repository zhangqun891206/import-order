"use client";
import dynamic from "next/dynamic";

// 导入流程完全在浏览器运行（文件解析 / pdfjs / 虚拟表格），禁用 SSR 预渲染。
const ImportFlow = dynamic(() => import("@/components/ImportFlow"), {
  ssr: false,
  loading: () => <div className="card p-10 text-center text-ink-3 text-sm">加载中…</div>,
});

export default function Home() {
  return <ImportFlow />;
}
