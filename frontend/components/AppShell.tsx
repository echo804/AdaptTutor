"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getToken, api } from "@/lib/api";
import { ACCENTS, MODES, applyTheme, loadThemePrefs, saveThemePrefs, type ThemeAccent, type ThemeMode } from "@/lib/theme";
import { useDomain } from "@/lib/domain";

const NAV = [
  { href: "/chat", label: "对话学习" },
  { href: "/graph", label: "知识图谱" },
  { href: "/review", label: "错题复盘" },
  { href: "/dashboard", label: "仪表盘" },
  { href: "/domains", label: "我的领域" },
  { href: "/settings", label: "设置" },
];

/** 顶栏 + 侧边栏双层布局（05 规范）；登录/注册页隐藏侧边栏。 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>("auto");
  const [accent, setAccent] = useState<ThemeAccent>("ink");
  const { packs, active, ready, setActive } = useDomain();

  const isAuthPage = pathname === "/login" || pathname === "/register";

  useEffect(() => {
    if (isAuthPage) return;
    const prefs = loadThemePrefs();
    setMode(prefs.mode);
    setAccent(prefs.accent);
    applyTheme(prefs.mode, prefs.accent);
  }, [isAuthPage]);

  const pickMode = (m: ThemeMode) => {
    setMode(m);
    saveThemePrefs(m, accent);
    applyTheme(m, accent);
  };
  const pickAccent = (a: ThemeAccent) => {
    setAccent(a);
    saveThemePrefs(mode, a);
    applyTheme(mode, a);
  };

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
          {/* 领域选择器（M4r8：领域学习空间） */}
          {ready && packs.length > 0 && (
            <select
              aria-label="切换学习领域"
              value={active ?? ""}
              onChange={(e) => setActive(e.target.value)}
              className="ml-2 rounded border px-2 py-0.5 text-xs"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border)",
                color: "var(--text)",
              }}
            >
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.subject}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          {username && (
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {username}
            </span>
          )}
          {/* 主题切换（明暗 + 色板） */}
          <div className="relative">
            <button
              aria-label="切换主题"
              title="主题设置"
              className="flex h-8 w-8 items-center justify-center rounded transition-opacity hover:opacity-80"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              onClick={() => setThemeOpen((v) => !v)}
            >
              {/* 调色板图标 */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22a10 10 0 1 1 10-10c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3c.5.6.2 1.7-.7 1.7H12z" />
                <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
                <circle cx="11" cy="7.5" r="1" fill="currentColor" />
                <circle cx="15.5" cy="7.5" r="1" fill="currentColor" />
                <circle cx="17" cy="11.5" r="1" fill="currentColor" />
              </svg>
            </button>
            {themeOpen && (
              <div
                className="absolute right-0 top-10 z-50 w-64 rounded-lg border p-3 shadow-lg animate-fade"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
              >
                <div className="mb-1 text-xs font-medium" style={{ color: "var(--muted)" }}>
                  明暗模式
                </div>
                <div className="mb-3 flex gap-1">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      className="flex-1 rounded px-2 py-1 text-xs transition-opacity hover:opacity-80"
                      style={{
                        background: mode === m.id ? "var(--accent-soft)" : "transparent",
                        color: mode === m.id ? "var(--accent)" : "var(--text)",
                        border: `1px solid ${mode === m.id ? "var(--accent)" : "var(--border)"}`,
                      }}
                      onClick={() => pickMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="mb-2 text-xs font-medium" style={{ color: "var(--muted)" }}>
                  主题色
                </div>
                <div className="flex items-center justify-between">
                  {ACCENTS.map((a) => {
                    const active = accent === a.id;
                    return (
                      <button
                        key={a.id}
                        aria-label={a.label}
                        title={a.label}
                        className="flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110"
                        style={{
                          background: a.light,
                          border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                          boxShadow: active ? "0 0 0 2px var(--surface), 0 0 0 4px var(--accent)" : undefined,
                        }}
                        onClick={() => pickAccent(a.id)}
                      >
                        {active && <span className="text-[10px] font-bold text-white">✓</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between text-[10px]" style={{ color: "var(--muted)" }}>
                  {ACCENTS.map((a) => (
                    <span key={a.id} className="w-9 text-center">
                      {a.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
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
