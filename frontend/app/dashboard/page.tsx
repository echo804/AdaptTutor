"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import LearningPathTree from "@/components/LearningPathTree";
import { api, MasteryOut, PathOut } from "@/lib/api";
import { useThemeVar } from "@/lib/theme";
import { useDomain } from "@/lib/domain";

/** 仪表盘（M4r3，05 §5.4）：今日推荐 → 掌握度总览 → 最近会话 → 学习趋势（M4r8 按领域） */
export default function DashboardPage() {
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [path, setPath] = useState<string[]>([]);
  const [trend, setTrend] = useState<{ date: string; count: number }[]>([]);
  const [sessions, setSessions] = useState<{ id: number; type: string; created_at: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // 主题强调色（图表色随色板切换）
  const amber = useThemeVar("--amber", "#d4a574");
  // 领域学习空间（M4r8）：掌握度/路径/趋势随领域切换重载
  const { active: activePack } = useDomain();

  useEffect(() => {
    if (!activePack) return;
    (async () => {
      try {
        const me = await api<{ user_id: number }>("/auth/me");
        const qp = `?pack_id=${activePack}`;
        // M6：单接口容错——一个失败不拖垮整页（避免 Failed to fetch 整页空白）
        const [m, p, t, sl] = await Promise.all([
          api<MasteryOut>(`/api/v1/students/${me.user_id}/mastery${qp}`).catch(() => null),
          api<PathOut>(`/api/v1/students/${me.user_id}/path${qp}`).catch(() => null),
          api<{ trend: { date: string; count: number }[] }>(`/api/v1/students/${me.user_id}/trend?pack_id=*`).catch(() => null),
          api<{ sessions: { id: number; type: string; created_at: string }[] }>("/api/v1/sessions").catch(() => null),
        ]);
        if (m) setMastery(m.mastery);
        if (p) setPath(p.path);
        if (t) setTrend(t.trend);
        if (sl) setSessions(sl.sessions || []);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, [activePack]);

  // 掌握度分布（六档）
  const dist = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0, 0];
    Object.values(mastery).forEach((p) => {
      const idx = Math.min(5, Math.floor(p * 6));
      buckets[idx] += 1;
    });
    return [
      { range: "0-16%", n: buckets[0] },
      { range: "17-33%", n: buckets[1] },
      { range: "34-50%", n: buckets[2] },
      { range: "51-66%", n: buckets[3] },
      { range: "67-83%", n: buckets[4] },
      { range: "84-100%", n: buckets[5] },
    ];
  }, [mastery]);

  const entries = Object.entries(mastery).sort((a, b) => a[1] - b[1]);
  const weakest = entries[0];
  const avgMastery = entries.length ? entries.reduce((s, [, p]) => s + p, 0) / entries.length : 0;

  const gaugeData = [{ name: "整体掌握", value: Math.round(avgMastery * 100) }];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">仪表盘</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* 今日推荐（05 §5.4 首屏） */}
      <div className="glass-card rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <h2 className="mb-2 text-sm font-medium">今日推荐</h2>
        {weakest ? (
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="font-medium">{weakest[0]}</span>
              <span className="ml-2" style={{ color: "var(--muted)" }}>掌握度 {Math.round(weakest[1] * 100)}%</span>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>这是当前最薄弱的星，建议从它开始点亮。</p>
            </div>
            <Link href="/chat" className="rounded px-4 py-1.5 text-sm font-medium text-white" style={{ background: "var(--accent)" }}>
              开始学习
            </Link>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>还没有诊断数据，先去对话页做一次诊断。</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 掌握度总览：分布 Bar */}
        <div className="glass-card rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium">掌握度分布</h2>
          {entries.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>暂无数据</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dist} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="range" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }} />
                <Bar dataKey="n" name="节点数" radius={[4, 4, 0, 0]}>
                  {dist.map((d, i) => (
                    <Cell key={i} fill={i >= 4 ? "#7ec8a0" : i >= 3 ? amber : "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 薄弱点 Gauge */}
        <div className="glass-card rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium">整体掌握度</h2>
          {entries.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>暂无数据</p>
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="45%" height={150}>
                <AreaChart data={gaugeData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="avgGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={amber} />
                      <stop offset="100%" stopColor="#94a3b8" />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[0, 100]} hide />
                  <Area type="monotone" dataKey="value" stroke="none" fill="url(#avgGrad)" />
                  <Tooltip contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="text-sm" style={{ color: "var(--muted)" }}>
                <div className="text-3xl font-semibold" style={{ color: "var(--text)" }}>{Math.round(avgMastery * 100)}%</div>
                共 {entries.length} 个知识点已测
                <div className="mt-2 text-xs">最弱：{weakest[0]}（{Math.round(weakest[1] * 100)}%）</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 学习路径树（05 §5.3） */}
      <div className="glass-card rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <h2 className="mb-2 text-sm font-medium">推荐学习路径</h2>
        {path.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>诊断后将生成路径。</p>
        ) : (
          <LearningPathTree path={path} mastery={mastery} />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* 学习趋势 Area */}
        <div className="glass-card rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium">学习趋势（近 14 天作答）</h2>
          {trend.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>暂无学习记录</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7ec8a0" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#7ec8a0" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--muted)" }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <Tooltip contentStyle={{ fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)" }} />
                <Area type="monotone" dataKey="count" name="作答数" stroke="#7ec8a0" strokeWidth={2} fill="url(#trendGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 最近会话 */}
        <div className="glass-card rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium">最近会话</h2>
          {sessions.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>暂无会话</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {sessions.slice(0, 6).map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <span>
                    {s.type === "diagnostic" ? "诊断" : s.type === "tutor" ? "辅导" : s.type}
                    <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>#{s.id}</span>
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
