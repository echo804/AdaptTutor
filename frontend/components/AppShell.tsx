"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken, getToken, api } from "@/lib/api";
import { ACCENTS, MODES, applyTheme, loadThemePrefs, saveThemePrefs, type ThemeAccent, type ThemeMode } from "@/lib/theme";
import { useDomain } from "@/lib/domain";
import FeedbackWidget from "@/components/FeedbackWidget";

const NAV = [
  {
    href: "/chat",
    label: "对话学习",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/graph",
    label: "知识图谱",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm14 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 8l3.5 9M17 8l-3.5 9" />
      </svg>
    ),
  },
  {
    href: "/report",
    label: "诊断报告",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h5" />
      </svg>
    ),
  },
  {
    href: "/review",
    label: "错题复盘",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "仪表盘",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: "/market",
    label: "领域市场",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l1.5-5h15L21 9M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
      </svg>
    ),
  },
  {
    href: "/domains",
    label: "我的领域",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "设置",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

/** 顶栏 + 侧边栏双层布局（05 规范）；登录/注册页隐藏侧边栏。 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<ThemeMode>("auto");
  const [accent, setAccent] = useState<ThemeAccent>("ink");
  const { packs, active, ready, setActive } = useDomain();

  // 免登录页：欢迎页 / 登录 / 注册（M4r9 欢迎页加入）
  const isAuthPage = pathname === "/" || pathname === "/login" || pathname === "/register";

  // 侧边栏折叠：localStorage 记忆 + 窄屏(<768px)默认折叠
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    const narrow = window.innerWidth < 768;
    setCollapsed(saved === "1" || (saved === null && narrow));
  }, []);

  const toggleSidebar = () => {
    setCollapsed((v) => {
      localStorage.setItem("sidebar-collapsed", v ? "0" : "1");
      return !v;
    });
  };

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
          <button
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={toggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded transition-opacity hover:opacity-80"
            style={{ color: "var(--muted)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
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
        {/* 侧边栏（可折叠：展开 w-48 / 折叠 w-14 图标模式，localStorage 记忆） */}
        <nav
          className={`${collapsed ? "w-14" : "w-48"} shrink-0 border-r p-2 transition-[width] duration-200`}
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              title={collapsed ? n.label : undefined}
              className={`mb-1 flex items-center rounded px-2 py-2 text-sm transition-opacity hover:opacity-80 ${collapsed ? "justify-center" : "gap-2"}`}
              style={{
                background: pathname === n.href ? "var(--accent-soft)" : "transparent",
                color: pathname === n.href ? "var(--accent)" : "var(--text)",
              }}
            >
              <span className="shrink-0">{n.icon}</span>
              {!collapsed && <span className="truncate">{n.label}</span>}
            </Link>
          ))}
        </nav>

        {/* 内容区：底层苏格拉底水印 + 上层页面内容 */}
        <main className="relative flex-1 overflow-auto">
          {/* 苏格拉底水印（M4r12：mask 蒙版，线条色 = --amber 与主题主色对比） */}
          <div className="socrates-watermark" aria-hidden />
          <div className="relative z-10 h-full">{children}</div>
        </main>
      </div>

      {/* 用户反馈（M4r22：右下角悬浮） */}
      <FeedbackWidget />
    </div>
  );
}
