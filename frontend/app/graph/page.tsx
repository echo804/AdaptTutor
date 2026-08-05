"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StarMap3D, { StarEdge, StarNode } from "@/components/StarMap3D";
import { api, MasteryOut } from "@/lib/api";
import { useThemeVar } from "@/lib/theme";
import { useDomain } from "@/lib/domain";

/** 知识图谱星辰图页（M4r2：星空 + 知识星点亮；点击星 → 详情卡 + 溯源发光路径；M4r8 按领域） */
export default function GraphPage() {
  const [graph, setGraph] = useState<{ nodes: StarNode[]; edges: StarEdge[] } | null>(null);
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 主题强调色（图例色随色板切换）
  const amber = useThemeVar("--amber", "#d4a574");
  // 领域学习空间（M4r8）：图谱/掌握度随领域切换重载
  const { active: activePack } = useDomain();

  useEffect(() => {
    if (!activePack) return;
    (async () => {
      try {
        const [g, me] = await Promise.all([
          api<{ nodes: StarNode[]; edges: StarEdge[] }>(`/api/v1/graph?pack_id=${activePack}`),
          api<{ user_id: number }>("/auth/me"),
        ]);
        setGraph(g);
        setSelected(null);
        const m = await api<MasteryOut>(`/api/v1/students/${me.user_id}/mastery?pack_id=${activePack}`).catch(
          () => ({ mastery: {}, weakest: null } as MasteryOut),
        );
        setMastery(m.mastery);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, [activePack]);

  // 溯源祖先链：沿前置边反向 BFS（暖色路径 + 链首为根因）
  const trace = useMemo(() => {
    if (!graph || !selected) return { chain: [], root: null as string | null };
    const adj: Record<string, string[]> = {};
    for (const e of graph.edges) {
      (adj[e.to] = adj[e.to] || []).push(e.from); // 反向：后继→前置
    }
    const chain: string[] = [];
    const visited = new Set<string>();
    const queue = [selected];
    visited.add(selected);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const pre of adj[cur] || []) {
        if (!visited.has(pre)) {
          visited.add(pre);
          chain.push(pre);
          queue.push(pre);
        }
      }
    }
    // 根因 = 最远前置（链末端）
    return { chain: [selected, ...chain], root: chain.length ? chain[chain.length - 1] : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selected]);

  const selectedNode = graph?.nodes.find((n) => n.id === selected);
  const selectedMastery = selected ? mastery[selected] : undefined;

  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!graph) return <div className="p-6 text-sm" style={{ color: "var(--muted)" }}>加载星辰图…</div>;

  return (
    <div className="relative h-full p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">知识图谱 · 星辰</h1>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: amber, boxShadow: `0 0 6px ${amber}` }} /> 已点亮</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "rgba(148,163,184,0.5)" }} /> 未完成</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ background: "rgba(148,163,184,0.25)" }} /> 未测</span>
        </div>
      </div>

      <div className="h-[calc(100%-3rem)] rounded-xl border" style={{ borderColor: "var(--border)", overflow: "hidden" }}>
        <StarMap3D
          nodes={graph.nodes}
          edges={graph.edges}
          mastery={mastery}
          selected={selected}
          onSelect={setSelected}
          traceChain={trace.chain}
          traceRoot={trace.root || undefined}
        />

        {/* 详情卡（选中星） */}
        {selectedNode && (
          <div
            className="absolute right-4 top-4 w-60 rounded-xl border p-4 shadow-lg"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">{selectedNode.name}</span>
              <button
                className="text-xs"
                style={{ color: "var(--muted)" }}
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>
            <div className="space-y-1 text-xs" style={{ color: "var(--muted)" }}>
              <div>节点：{selectedNode.id}</div>
              <div>
                掌握度：
                {selectedMastery !== undefined ? (
                  <span style={{ color: selectedMastery >= 0.5 ? "var(--accent)" : "var(--warn)" }}>
                    {Math.round(selectedMastery * 100)}%（{selectedMastery >= 0.5 ? "已点亮" : "未完成"}）
                  </span>
                ) : (
                  "未测"
                )}
              </div>
              {trace.chain.length > 1 && (
                <div>溯源根因：<span style={{ color: "var(--accent)" }}>{trace.root}</span></div>
              )}
            </div>
            <Link
              href="/chat"
              className="mt-3 block rounded px-3 py-1.5 text-center text-xs font-medium text-white"
              style={{ background: "var(--accent)" }}
            >
              开始学习
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
