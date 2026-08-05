"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MagicBook from "@/components/MagicBook";
import StarMap3D, { StarEdge, StarNode } from "@/components/StarMap3D";
import { api, MasteryOut } from "@/lib/api";
import { useThemeVar } from "@/lib/theme";
import { useDomain } from "@/lib/domain";
import { loadBookshelf, type BookInfo } from "@/lib/bookshelf";

/** 知识图谱 · 魔法书架（M4r11）：所有领域各是一本魔法书，点击打开 → 书页全屏展开星辰图。
 * 书架状态：暖木色书架背景 + 书籍排布 + 掌握度图例；展开状态：StarMap3D 星空 + 「合上书」返回。
 */
export default function GraphPage() {
  const [books, setBooks] = useState<BookInfo[] | null>(null);
  const [bookErr, setBookErr] = useState<string | null>(null);
  // 展开状态：当前打开的书（null = 书架）
  const [open, setOpen] = useState<BookInfo | null>(null);
  const [graph, setGraph] = useState<{ nodes: StarNode[]; edges: StarEdge[] } | null>(null);
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 主题强调色（图例色随色板切换）
  const amber = useThemeVar("--amber", "#d4a574");
  // 领域学习空间（M4r8）：激活领域
  const { packs, active, setActive } = useDomain();

  // 书架：加载所有领域数据
  useEffect(() => {
    (async () => {
      try {
        const b = await loadBookshelf();
        setBooks(b);
        setBookErr(null);
      } catch (e: any) {
        setBookErr(e.message);
      }
    })();
  }, [packs, active]);

  // 展开某本书：加载该书星辰图数据
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [g, me] = await Promise.all([
          api<{ nodes: StarNode[]; edges: StarEdge[] }>(`/api/v1/graph?pack_id=${encodeURIComponent(open.id)}`),
          api<{ user_id: number }>("/auth/me"),
        ]);
        if (cancelled) return;
        setGraph(g);
        setSelected(null);
        const m = await api<MasteryOut>(`/api/v1/students/${me.user_id}/mastery?pack_id=${encodeURIComponent(open.id)}`).catch(
          () => ({ mastery: {}, weakest: null } as MasteryOut),
        );
        if (!cancelled) setMastery(m.mastery);
      } catch (e: any) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 溯源祖先链：沿前置边反向 BFS（暖色路径 + 链首为根因）
  const trace = (() => {
    if (!graph || !selected) return { chain: [] as string[], root: null as string | null };
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
    return { chain: [selected, ...chain], root: chain.length ? chain[chain.length - 1] : null };
  })();

  const selectedNode = graph?.nodes.find((n) => n.id === selected);
  const selectedMastery = selected ? mastery[selected] : undefined;

  // ---- 展开状态：星辰图 ----
  if (open) {
    return (
      <div className="relative h-full p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            知识图谱 · 星辰 ——《{open.subject}》
          </h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: amber, boxShadow: `0 0 6px ${amber}` }} /> 已点亮</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "rgba(148,163,184,0.5)" }} /> 未完成</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ background: "rgba(148,163,184,0.25)" }} /> 未测</span>
            </div>
            <button
              className="rounded-full px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              onClick={() => {
                setOpen(null);
                setGraph(null);
                setSelected(null);
                setErr(null);
              }}
            >
              ← 合上书
            </button>
          </div>
        </div>

        {err && <div className="p-4 text-sm text-red-600">{err}</div>}
        {!graph && !err && (
          <div className="flex h-[calc(100%-3rem)] items-center justify-center rounded-xl border" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            正在翻开《{open.subject}》… 星空即将显现
          </div>
        )}
        {graph && (
          <div className="relative h-[calc(100%-3rem)] rounded-xl border" style={{ borderColor: "var(--border)", overflow: "hidden" }}>
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
        )}
      </div>
    );
  }

  // ---- 书架状态 ----
  if (bookErr) return <div className="p-6 text-sm text-red-600">{bookErr}</div>;
  if (!books) return <div className="p-6 text-sm" style={{ color: "var(--muted)" }}>正在整理书架…</div>;

  return (
    <div className="relative h-full overflow-auto">
      {/* 暖木色书架背景 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #2a1c10 0%, #3a2716 40%, #2f2012 100%)",
        }}
        aria-hidden
      />
      {/* 木质横板纹理 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(212,165,116,0.06) 0 2px, transparent 2px 18px), repeating-linear-gradient(90deg, rgba(212,165,116,0.04) 0 60px, transparent 60px 120px)",
        }}
        aria-hidden
      />

      <div className="relative z-10 mx-auto max-w-5xl p-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "#f2e6d5" }}>
              知识书库
            </h1>
            <p className="mt-1 text-sm" style={{ color: "rgba(242,230,213,0.6)" }}>
              每一本都是一片星空——翻开书，点亮你的知识星辰
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs" style={{ color: "rgba(242,230,213,0.65)" }}>
            <span className="flex items-center gap-1"><span className="text-sm" style={{ color: amber }}>★</span> 已点亮</span>
            <span className="flex items-center gap-1"><span className="text-sm" style={{ color: "rgba(148,163,184,0.6)" }}>★</span> 未完成</span>
            <span className="flex items-center gap-1"><span className="text-sm" style={{ color: "rgba(148,163,184,0.3)" }}>☆</span> 未测</span>
          </div>
        </div>

        {books.length === 0 ? (
          <div
            className="mt-16 rounded-xl border border-dashed p-10 text-center text-sm"
            style={{ borderColor: "rgba(212,165,116,0.4)", color: "rgba(242,230,213,0.7)" }}
          >
            书架上还没有魔法书。去「领域市场」或「我的领域」获取第一本，开始点亮星空 ✨
          </div>
        ) : (
          <div className="flex flex-wrap gap-8 py-4">
            {books.map((b) => (
              <MagicBook
                key={b.id}
                book={b}
                active={active === b.id}
                onOpen={() => {
                  setOpen(b);
                  // 打开时同步切换激活领域（顶栏下拉一致）
                  if (active !== b.id) setActive(b.id).catch(() => {});
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
