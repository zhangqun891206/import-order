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
    <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-6 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white font-bold"
            style={{ background: "linear-gradient(135deg,#0fc6c2,#0bada9)" }}
          >
            万
          </span>
          <span className="text-[15px] font-semibold text-ink">
            万能导入 <span className="text-brand-dark">V2</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          {items.map((it) => {
            const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active ? "bg-brand-soft font-medium text-brand-dark" : "text-ink-2 hover:bg-bg"
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
