"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useDomain } from "@/lib/domain";
import MathText from "@/components/Math";

/** 复盘错题集 · 抽卡（M4r5c 需求 2）：正面题目 / 翻面见答案；"已掌握"移出 */
interface WrongQuestion {
  qid: string;
  ts: string;
  question: string;
  type: string;
  options: string[];
  user_answer: string;
  correct_answer: string;
  node_id: string | null;
}

const QTYPE_LABELS: Record<string, string> = { choice: "选择", blank: "填空", open: "解答" };

export default function ReviewPage() {
  const [items, setItems] = useState<WrongQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // 领域学习空间（M4r8）：错题集按领域隔离
  const { active: activePack } = useDomain();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api<{ user_id: number }>("/auth/me");
      const qp = activePack ? `?pack_id=${activePack}` : "";
      const r = await api<{ items: WrongQuestion[] }>(`/api/v1/students/${me.user_id}/wrong-questions${qp}`);
      setItems(r.items || []);
      setIdx(0);
      setFlipped(false);
    } catch (e: any) {
      setErr(e.message || "加载错题失败");
    } finally {
      setLoading(false);
    }
  }, [activePack]);
  useEffect(() => {
    load();
  }, [load]);

  const current = items[idx] || null;

  async function markMastered() {
    if (!current) return;
    try {
      const me = await api<{ user_id: number }>("/auth/me");
      const qp = activePack ? `?pack_id=${activePack}` : "";
      await api<{ removed: string }>(`/api/v1/students/${me.user_id}/wrong-questions/${current.qid}${qp}`, { method: "DELETE" });
      setItems((list) => list.filter((i) => i.qid !== current.qid));
      setFlipped(false);
      // idx 指向下一张（若删的是最后一张则回到开头）
      setIdx((i) => Math.min(i, items.length - 2));
    } catch (e: any) {
      setErr(e.message || "移除失败");
    }
  }

  if (loading) return <div className="p-6 text-sm" style={{ color: "var(--muted)" }}>加载错题集…</div>;
  if (err) return <div className="p-6 text-sm text-red-500">{err}</div>;

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">复盘错题集 · 抽卡</h1>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {items.length > 0 ? `${idx + 1} / ${items.length}` : "0 张"}
          <button className="ml-3" style={{ color: "var(--accent)" }} onClick={load}>↻ 刷新</button>
        </div>
      </div>

      {!current ? (
        <div className="glass-card rounded-xl border p-8 text-center" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--muted)" }}>错题集是空的 🎉</p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>诊断/练习中答错的题会自动收录到这里，点击卡片翻面查看答案。</p>
        </div>
      ) : (
        <>
          {/* 卡片（3D 翻转） */}
          <div className="mb-4 [perspective:1200px]" onClick={() => setFlipped((f) => !f)}>
            <div
              className="relative min-h-[260px] w-full transition-transform duration-500 [transform-style:preserve-3d]"
              style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", cursor: "pointer" }}
            >
              {/* 正面：题目 */}
              <div
                className="glass-card absolute inset-0 flex flex-col rounded-2xl border p-6 [backface-visibility:hidden]"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    {QTYPE_LABELS[current.type] || current.type}题
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>点击翻面看答案</span>
                </div>
                <div className="flex-1 text-[15px] leading-relaxed">
                  <MathText text={current.question} />
                </div>
                {current.type === "choice" && current.options && (
                  <div className="mt-3 space-y-1">
                    {current.options.map((o, i) => (
                      <div key={i} className="text-sm">
                        {String.fromCharCode(65 + i)}. <MathText text={o} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 背面：答案对照 */}
              <div
                className="glass-card absolute inset-0 flex flex-col rounded-2xl border p-6 [backface-visibility:hidden] [transform:rotateY(180deg)]"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>答案对照</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>点击翻回题目</span>
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="mb-1 text-xs" style={{ color: "var(--warn)" }}>我的答案</div>
                    <MathText text={current.user_answer || "（未作答）"} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs" style={{ color: "var(--success)" }}>正确答案</div>
                    <MathText text={current.correct_answer || "—"} />
                  </div>
                  {current.node_id && (
                    <div className="text-xs" style={{ color: "var(--muted)" }}>
                      关联知识点：{current.node_id}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 操作 */}
          <div className="flex items-center justify-center gap-3">
            <button
              className="rounded-lg border px-5 py-2 text-sm"
              style={{ borderColor: "var(--border)" }}
              onClick={() => { setFlipped(false); setIdx((i) => (i + items.length - 1) % items.length); }}
              disabled={items.length < 2}
            >
              ← 上一张
            </button>
            <button
              className="rounded-lg px-5 py-2 text-sm text-white"
              style={{ background: "var(--accent)" }}
              onClick={() => { setFlipped(false); setIdx((i) => (i + 1) % items.length); }}
            >
              下一张 →
            </button>
            <button
              className="rounded-lg px-5 py-2 text-sm"
              style={{ background: "var(--success)", color: "#0f172a" }}
              onClick={markMastered}
            >
              ✓ 已掌握，移出
            </button>
          </div>
          <p className="mt-3 text-center text-xs" style={{ color: "var(--muted)" }}>
            共 {items.length} 张错题卡 · 每张都来自你判错的题
          </p>
        </>
      )}
    </div>
  );
}
