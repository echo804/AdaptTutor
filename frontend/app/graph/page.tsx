"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, MasteryOut } from "@/lib/api";

interface GNode {
  id: string;
  name: string;
  difficulty: number;
  importance: number;
}
interface GEdge {
  from: string;
  to: string;
  type: string;
}

/** 图谱可视化（@xyflow/react；05 规范：图谱深色画布，掌握度低节点高亮） */
export default function GraphPage() {
  const [graph, setGraph] = useState<{ nodes: GNode[]; edges: GEdge[] } | null>(null);
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [g, me] = await Promise.all([
          api<{ nodes: GNode[]; edges: GEdge[] }>("/api/v1/graph"),
          api<{ user_id: number }>("/auth/me"),
        ]);
        setGraph(g);
        const m = await api<MasteryOut>(`/api/v1/students/${me.user_id}/mastery`).catch(
          () => ({ mastery: {}, weakest: null } as MasteryOut),
        );
        setMastery(m.mastery);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    // 分层布局：按节点 id 前缀分段（a/b/c/d 模块），简单网格
    const columns: Record<string, number> = {};
    graph.nodes.forEach((n, i) => {
      const prefix = n.id.replace(/[0-9]/g, "");
      columns[prefix] = columns[prefix] ?? 0;
      columns[prefix] += 1;
    });
    const colIndex: Record<string, number> = {};
    const nid: Node[] = graph.nodes.map((n, i) => {
      const prefix = n.id.replace(/[0-9]/g, "");
      const idx = colIndex[prefix] ?? 0;
      colIndex[prefix] = idx + 1;
      const p = mastery[n.id];
      const weak = p !== undefined && p < 0.5;
      return {
        id: n.id,
        position: { x: (Object.keys(columns).indexOf(prefix) - 1) * 220 + 40, y: idx * 90 + 20 },
        data: { label: `${n.name}` },
        style: {
          background: weak ? "#c0392b" : p !== undefined ? "#2e7d32" : "var(--surface)",
          color: "#fff",
          border: `1px solid ${weak ? "#e74c3c" : p !== undefined ? "#43a047" : "var(--border)"}`,
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 12,
        },
      } satisfies Node;
    });
    const eid: Edge[] = graph.edges.map((e, i) => ({
      id: `e-${i}`,
      source: e.from,
      target: e.to,
      animated: false,
      style: { stroke: "var(--border)" },
    }));
    return { nodes: nid, edges: eid };
  }, [graph, mastery]);

  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!graph) return <div className="p-6 text-sm" style={{ color: "var(--muted)" }}>加载图谱…</div>;

  return (
    <div className="h-full p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">知识图谱</h1>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: "#2e7d32" }} /> 掌握（≥0.5）</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: "#c0392b" }} /> 薄弱（&lt;0.5）</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border" style={{ background: "var(--surface)", borderColor: "var(--border)" }} /> 未测</span>
        </div>
      </div>
      <div className="h-[calc(100%-3rem)] rounded-xl border" style={{ borderColor: "var(--border)", background: "#14161c" }}>
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background color="#3a3f4a" gap={18} />
          <Controls />
          <MiniMap
            nodeColor={(n) => (n.style?.background as string) || "#888"}
            maskColor="rgba(20,22,28,0.7)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
