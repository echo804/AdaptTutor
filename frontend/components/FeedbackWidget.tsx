"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

/** 用户反馈（M4r22）：右下角悬浮按钮 → 弹窗表单，复古玻璃风。
 * 提交后显示成功状态；支持分类选择；我的历史反馈列表。
 */

const CATEGORIES = [
  { id: "bug", label: "问题反馈" },
  { id: "suggestion", label: "功能建议" },
  { id: "question", label: "使用疑问" },
  { id: "other", label: "其他" },
] as const;

interface FeedbackItem {
  id: number;
  content: string;
  category: string;
  status: string;
  created_at: string;
}

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("suggestion");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<FeedbackItem[]>([]);
  // M4r22d：删除确认（站内弹窗，替代原生 confirm）
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 打开时加载历史
  useEffect(() => {
    if (!open) return;
    api<{ items: FeedbackItem[] }>("/me/feedback")
      .then((r) => setHistory(r.items || []))
      .catch(() => {});
  }, [open]);

  async function submit() {
    if (!content.trim()) {
      setErr("请填写反馈内容");
      return;
    }
    setErr(null);
    setMsg(null);
    setSubmitting(true);
    try {
      await api("/me/feedback", { method: "POST", body: { content: content.trim(), category } });
      setContent("");
      setMsg("反馈已提交，感谢你的建议！");
      const r = await api<{ items: FeedbackItem[] }>("/me/feedback");
      setHistory(r.items || []);
    } catch (e: any) {
      setErr(e.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  // M4r22c：删除自己的反馈（站内确认，M4r22d 替代原生 confirm）
  async function deleteFeedback(id: number) {
    setErr(null);
    setMsg(null);
    try {
      await api(`/me/feedback/${id}`, { method: "DELETE" });
      setHistory((prev) => prev.filter((h) => h.id !== id));
      setMsg("已删除");
    } catch (e: any) {
      setErr(e.message || "删除失败");
    }
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        className="fixed bottom-6 right-6 z-[90] flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110"
        style={{ background: "var(--amber)", color: "#1a1a1a", boxShadow: "0 4px 20px rgba(212,165,116,0.5)" }}
        onClick={() => setOpen((v) => !v)}
        aria-label="意见反馈"
        title="意见反馈"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5 h16 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 h-9 l-5 4 v-4 h-2 a2 2 0 0 1 -2 -2 v-8 a2 2 0 0 1 2 -2 z" />
          <path d="M8 10 h8" />
          <path d="M8 13.5 h5" />
        </svg>
      </button>

      {/* 弹窗 */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          style={{ background: "rgba(10,15,30,0.5)", backdropFilter: "blur(4px)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="feedback-modal w-full max-w-md rounded-2xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold" style={{ color: "var(--text)" }}>
                意见反馈
              </h3>
              <button className="text-lg" style={{ color: "var(--muted)" }} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            {/* 分类 */}
            <div className="mb-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  className="rounded-full px-3 py-1 text-xs transition-colors"
                  style={{
                    background: category === c.id ? "var(--accent)" : "var(--accent-soft)",
                    color: category === c.id ? "#fff" : "var(--accent)",
                  }}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* 内容 */}
            <textarea
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)", minHeight: 90 }}
              placeholder="写下你的想法、遇到的问题或建议…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />

            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
            {msg && <p className="mt-2 text-xs" style={{ color: "#7ec8a0" }}>{msg}</p>}

            <div className="mt-3 flex justify-end gap-3">
              <button
                className="rounded-full px-4 py-1.5 text-sm"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                onClick={() => setOpen(false)}
              >
                关闭
              </button>
              <button
                className="rounded-full px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
                disabled={submitting}
                onClick={submit}
              >
                {submitting ? "提交中…" : "提交反馈"}
              </button>
            </div>

            {/* 我的历史反馈 */}
            {history.length > 0 && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <div className="mb-2 text-xs font-medium" style={{ color: "var(--muted)" }}>
                  我的反馈（{history.length}）
                </div>
                <div className="max-h-32 space-y-1.5 overflow-auto">
                  {history.slice(0, 5).map((h) => (
                    <div key={h.id} className="rounded-lg border px-3 py-1.5 text-xs" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text)" }}>{h.content}</span>
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{
                          background: h.status === "done" ? "#7ec8a022" : h.status === "read" ? "var(--amber-soft)" : "var(--accent-soft)",
                          color: h.status === "done" ? "#7ec8a0" : h.status === "read" ? "var(--amber)" : "var(--accent)",
                        }}>
                          {{ new: "待处理", read: "已读", done: "已解决" }[h.status] || h.status}
                        </span>
                        {/* M4r22c：删除自己的反馈（站内确认） */}
                        <button
                          className="shrink-0 text-[10px]"
                          style={{ color: "var(--warn)" }}
                          onClick={() => setPendingDelete(h.id)}
                          title="删除"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 删除确认弹窗（M4r22d：站内确认，替代原生 confirm） */}
      {pendingDelete !== null && (
        <ConfirmDialog
          title="删除反馈"
          message="确认删除这条反馈？"
          confirmText="删除"
          cancelText="取消"
          danger
          onConfirm={() => {
            const id = pendingDelete;
            setPendingDelete(null);
            deleteFeedback(id);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
