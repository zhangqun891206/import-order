import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "万能导入 V2 · 智能多格式批量下单",
  description: "规则引擎 + 大模型辅助解析，任意格式文件智能导入下单",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <Nav />
        <main className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6">{children}</main>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
