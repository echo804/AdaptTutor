"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getToken, api } from "@/lib/api";

const NAV = [
  { href: "/chat", label: "对话学习" },
  { href: "/graph", label: "知识图谱" },
  { href: "/review", label: "错题复盘" },
  { href: "/dashboard", label: "仪表盘" },
  { href: "/settings", label: "设置" },
];

/** 顶栏 + 侧边栏双层布局（05 规范）；登录/注册页隐藏侧边栏。 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);

  const isAuthPage = pathname === "/login" || pathname === "/register";

  useEffect(() => {
    if (isAuthPage) return;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<{ user_id: number; username: string }>("/auth/me")
      .then((me) => setUsername(me.username))
      .catch(() => {
        clearToken();
        router.replace("/login");
      });
  }, [pathname, router, isAuthPage]);

  if (isAuthPage) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="flex h-screen flex-col">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold" style={{ color: "var(--accent)" }}>
            AdaptTutor
          </span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            自适应学习
          </span>
        </div>
        <div className="flex items-center gap-3">
          {username && (
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {username}
            </span>
          )}
          <button
            className="rounded px-3 py-1 text-sm hover:opacity-80"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
            onClick={() => {
              clearToken();
              router.replace("/login");
            }}
          >
            退出
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 侧边栏 */}
        <nav className="w-48 shrink-0 border-r p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="mb-1 block rounded px-3 py-2 text-sm transition-opacity hover:opacity-80"
              style={{
                background: pathname === n.href ? "var(--accent-soft)" : "transparent",
                color: pathname === n.href ? "var(--accent)" : "var(--text)",
              }}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        {/* 内容区 */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
