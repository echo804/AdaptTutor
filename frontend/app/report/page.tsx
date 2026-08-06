"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, MasteryOut, PathOut } from "@/lib/api";
import { useDomain } from "@/lib/domain";
import { useThemeVar } from "@/lib/theme";
import LearningPathTree from "@/components/LearningPathTree";
import StarMap3D, { StarEdge, StarNode } from "@/components/StarMap3D";

/** 诊断报告页（M4r17，对齐 05 §5.3）：一句话总结 + 图谱缩略（溯源高亮）+ 推荐路径卡片 + 错题 + 趋势。
 * 全部复用现有接口（mastery/path/graph/trend/wrong-questions），零后端改动。
 */

interface WrongQ {
  id: number;
  question: string;
  created_at: string;
}

export default function ReportPage() {
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [weakest, setWeakest] = useState<string | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [graph, setGraph] = useState<{ nodes: StarNode[]; edges: StarEdge[] } | null>(null);
  const [wrong, setWrong] = useState<WrongQ[]>([]);
  const [trend, setTrend] = useState<{ date: string; count: number }[]>([]);
  const [nodeNames, setNodeNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const amber = useThemeVar("--amber", "#d4a574");
  const { active: activePack } = useDomain();

  useEffect(() => {
    if (!activePack) return;
    (async () => {
      try {
        const me = await api<{ user_id: number }>("/auth/me");
        const qp = `?pack_id=${activePack}`;
        const [m, p, g, w, t] = await Promise.all([
          api<MasteryOut>(`/api/v1/students/${me.user_id}/mastery${qp}`).catch(() => ({ mastery: {}, weakest: null })),
          api<PathOut>(`/api/v1/students/${me.user_id}/path${qp}`).catch(() => ({ path: [] })),
          api<{ nodes: StarNode[]; edges: StarEdge[] }>(`/api/v1/graph${qp}`).catch(() => ({ nodes: [], edges: [] })),
          api<{ items: WrongQ[] }>(`/api/v1/students/${me.user_id}/wrong-questions`).catch(() => ({ items: [] })),
          api<{ trend: { date: string; count: number }[] }>(`/api/v1/students/${me.user_id}/trend?pack_id=*`).catch(() => ({ trend: [] })),
        ]);
        setMastery(m.mastery || {});
        setWeakest(m.weakest || null);
        setPath(p.path || []);
        setGraph(g);
        const names: Record<string, string> = {};
        (g.nodes || []).forEach((n) => (names[n.id] = n.name));
        setNodeNames(names);
        setWrong(w.items || []);
        setTrend(t.trend || []);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, [activePack]);

  const entries = Object.entries(mastery);
  const avg =
    entries.length > 0
      ? entries.reduce((s, [, v]) => s + v, 0) / entries.length
      : 0;
  // 溯源祖先链（复用 graph 页逻辑）
  const trace = (() => {
    if (!graph || !selected) return { chain: [] as string[], root: null as string | null };
    const adj: Record<string, string[]> = {};
    for (const e of graph.edges) (adj[e.to] = adj[e.to] || []).push(e.from);
    const chain: string[] = [];
    const visited = new Set<string>();
    const queue = [selected];
    visited.add(selected);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const pre of adj[cur] || []) {
        if (!visited.has(pre)) { visited.add(pre); chain.push(pre); queue.push(pre); }
      }
    }
    return { chain: [selected, ...chain], root: chain.length ? chain[chain.length - 1] : null };
  })();

  // 一句话总结（05 §5.3）
  const summary =
    entries.length === 0
      ? "还没有诊断数据。去「对话学习」做一次诊断，生成你的专属报告。"
      : avg >= 0.7
        ? `整体掌握度 ${Math.round(avg * 100)}%，状态不错。当前最薄弱是「${weakest ? nodeNames[weakest] || weakest : "—"}」，巩固一下就能点亮更多星辰。`
        : `整体掌握度 ${Math.round(avg * 100)}%，核心薄弱点在「${weakest ? nodeNames[weakest] || weakest : "—"}」，建议优先补齐前置知识点。`;

  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* 顶部：一句话总结（大号，05 §5.3） */}
      <div className="glass-card rounded-2xl border p-6" style={{ borderColor: "var(--border)" }}>
        <div className="mb-1 text-xs tracking-widest" style={{ color: "var(--muted)" }}>
          诊断报告 · {activePack || ""}
        </div>
        <p className="text-lg font-medium leading-relaxed" style={{ color: "var(--text)" }}>
          {summary}
        </p>
        <div className="mt-3 flex items-center gap-4 text-sm">
          <span style={{ color: "var(--muted)" }}>
            已测 {entries.length} 节点 · 平均掌握度{" "}
            <b style={{ color: avg >= 0.7 ? "#7ec8a0" : amber }}>{Math.round(avg * 100)}%</b>
          </span>
          <Link href="/chat" className="rounded-full px-4 py-1 text-xs font-medium" style={{ background: "var(--accent)", color: "#fff" }}>
            去学习 →
          </Link>
        </div>
      </div>

      {/* 图谱缩略（深色画布 + 溯源高亮） */}
      <div className="mt-4 overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", height: 340 }}>
        {graph && graph.nodes.length > 0 ? (
          <StarMap3D
            nodes={graph.nodes}
            edges={graph.edges}
            mastery={mastery}
            selected={selected}
            onSelect={setSelected}
            traceChain={trace.chain}
            traceRoot={trace.root || undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
            暂无图谱数据
          </div>
        )}
      </div>

      {/* 推荐学习路径（05 §5.3：卡片列表） */}
      <div className="mt-4 glass-card rounded-2xl border p-5" style={{ borderColor: "var(--border)" }}>
        <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text)" }}>
          推荐学习路径
        </h2>
        {path.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>诊断后将生成路径。</p>
        ) : (
          <>
            <LearningPathTree path={path} mastery={mastery} names={nodeNames} height={150} />
            <div className="mt-3 space-y-2">
              {path.map((id, i) => {
                const p = mastery[id];
                return (
                  <div key={id} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        {i + 1}
                      </span>
                      <span style={{ color: "var(--text)" }}>{nodeNames[id] || id}</span>
                    </div>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {p !== undefined ? `${Math.round(p * 100)}%` : "未测"}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* 错题清单 */}
        <div className="glass-card rounded-2xl border p-5" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text)" }}>
            错题清单（{wrong.length}）
          </h2>
          {wrong.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>没有错题，继续保持 🎉</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {wrong.slice(0, 6).map((w) => (
                <li key={w.id} className="truncate" style={{ color: "var(--muted)" }}>
                  {w.question}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 学习趋势 */}
        <div className="glass-card rounded-2xl border p-5" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text)" }}>
            学习趋势（近 14 天）
          </h2>
          {trend.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>暂无学习记录</p>
          ) : (
            <div className="flex h-28 items-end gap-1">
              {trend.slice(-14).map((d, i) => {
                const max = Math.max(...trend.map((x) => x.count), 1);
                const h = Math.round((d.count / max) * 100);
                return (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full rounded-t" style={{ height: `${Math.max(h, 4)}%`, background: amber, opacity: 0.5 + (h / 100) * 0.5 }} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
