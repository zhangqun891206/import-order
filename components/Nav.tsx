"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "文件导入", icon: "⬆️" },
  { href: "/rules", label: "解析规则", icon: "⚙️" },
  { href: "/waybills", label: "已导入运单", icon: "📦" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 z-40 flex h-screen w-[72px] shrink-0 flex-col border-r border-line bg-white md:w-[220px]">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 px-4 py-5 md:px-5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white font-bold text-lg"
          style={{ background: "linear-gradient(135deg,#0fc6c2,#0bada9)" }}
        >
          万
        </span>
        <span className="hidden text-[15px] font-semibold text-ink md:block">
          万能导入 <span className="text-brand-dark">V2</span>
        </span>
      </Link>

      {/* 菜单 */}
      <nav className="flex flex-col gap-1 px-3">
        {items.map((it) => {
          const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              title={it.label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-brand-soft font-medium text-brand-dark"
                  : "text-ink-2 hover:bg-bg"
              }`}
            >
              <span className="text-base leading-none">{it.icon}</span>
              <span className="hidden md:inline">{it.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 底部说明 */}
      <div className="mt-auto px-4 pb-5 md:px-5">
        <div className="hidden rounded-lg bg-bg p-3 text-xs text-ink-3 md:block">
          规则引擎 + 大模型
          <br />
          智能多格式批量下单
        </div>
      </div>
    </aside>
  );
}
