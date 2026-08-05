"use client";

import { useRef, useEffect, useState } from "react";
import MathText from "@/components/Math";
import { api, MessageReply, Question, SessionCreated } from "@/lib/api";

/** 四态指示器（05 规范：探明→识别错误→最小提示→变式验证，半透明圆点组） */
const STATES = [
  { id: "elicit", label: "探明卡点" },
  { id: "identify", label: "识别错误" },
  { id: "hint", label: "最小提示" },
  { id: "verify", label: "变式验证" },
];

interface Bubble {
  role: "user" | "assistant";
  content: string;
  state?: string;
}

export default function ChatPage() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<"diagnostic" | "tutor" | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [state, setState] = useState<string>("elicit");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // M4r1：AI 判题——作答输入（choice→选项字母；blank/open→文本）
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [judgeResult, setJudgeResult] = useState<{ correct: boolean; feedback: string; method?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles, currentQuestion]);

  async function startSession(type: "diagnostic" | "tutor") {
    setErr(null);
    setLoading(true);
    try {
      const s = await api<SessionCreated>("/api/v1/sessions", {
        method: "POST",
        body: { type },
      });
      setSessionId(s.session_id);
      setSessionType(type);
      setState("elicit");
      if (s.question) setCurrentQuestion(s.question); // 诊断首题（作答按钮）
      if (s.first_message) {
        setBubbles([{ role: "assistant", content: s.first_message, state: "elicit" }]);
      }
    } catch (e: any) {
      setErr(e.message || "创建会话失败");
    } finally {
      setLoading(false);
    }
  }

  async function send(kind: "answer" | "message", answer?: string) {
    if (!sessionId || loading) return;
    setErr(null);
    setLoading(true);
    try {
      const userText =
        kind === "answer"
          ? (answer ?? "").trim() || "作答"
          : input.trim();
      if (kind === "message" && input.trim()) setInput("");

      const body =
        kind === "answer"
          ? { kind, answer: (answer ?? "").trim() }
          : { kind, content: userText || "继续" };

      const r = await api<MessageReply>(`/api/v1/sessions/${sessionId}/messages`, {
        method: "POST",
        body,
      });

      setState(r.state);
      setCurrentQuestion(r.question);
      // AI 判题反馈（M4r1）
      if (kind === "answer" && r.correct !== null) {
        setJudgeResult({ correct: r.correct, feedback: r.feedback || "", method: r.judge_method || undefined });
        setBubbles((b) => [...b, { role: "user", content: userText }]);
        setBubbles((b) => [...b, { role: "assistant", content: `${r.correct ? "✓ 答对了" : "✗ 答错了"}：${r.feedback || ""}`, state: r.state }]);
      } else {
        setJudgeResult(null);
        setBubbles((b) => [...b, { role: "user", content: userText }]);
        setBubbles((b) => [...b, { role: "assistant", content: r.message, state: r.state }]);
      }
      // 作答态复位
      setSelectedChoice(null);
      setAnswerText("");
    } catch (e: any) {
      setErr(e.message || "发送失败");
    } finally {
      setLoading(false);
    }
  }

  if (!sessionType) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md space-y-4 p-6">
          <h1 className="text-center text-lg font-semibold">开始一次学习</h1>
          <p className="text-center text-sm" style={{ color: "var(--muted)" }}>
            选择会话类型，AI 将按 诊断 → 路径 → 讲解 → 练习 引导你
          </p>
          <button
            className="w-full rounded-xl border p-6 text-left transition-opacity hover:opacity-80"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            onClick={() => startSession("diagnostic")}
            disabled={loading}
          >
            <div className="font-medium">诊断测试</div>
            <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              几道题定位薄弱知识点，生成学习路径
            </div>
          </button>
          <button
            className="w-full rounded-xl border p-6 text-left transition-opacity hover:opacity-80"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            onClick={() => startSession("tutor")}
            disabled={loading}
          >
            <div className="font-medium">辅导练习</div>
            <div className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              苏格拉底式引导：只给提示，不给答案
            </div>
          </button>
          {err && <p className="text-center text-sm text-red-600">{err}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* 左：对话区 */}
      <div className="flex flex-1 flex-col">
        {/* 状态指示器（半透明，不抢注意力） */}
        <div className="flex shrink-0 items-center justify-center gap-2 border-b py-2 opacity-60" style={{ borderColor: "var(--border)" }}>
          {STATES.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-1 text-xs"
              style={{ color: s.id === state ? "var(--accent)" : "var(--muted)" }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: s.id === state ? "var(--accent)" : "var(--border)" }}
              />
              {s.label}
            </span>
          ))}
          <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
            {sessionType === "diagnostic" ? "诊断" : "辅导"}
          </span>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 space-y-3 overflow-auto p-4">
          {bubbles.map((b, i) => (
            <div key={i} className={`flex animate-fade ${b.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-2 text-sm"
                style={{
                  background: b.role === "user" ? "var(--accent)" : "var(--surface)",
                  color: b.role === "user" ? "#fff" : "var(--text)",
                  border: b.role === "user" ? "none" : `1px solid var(--border)`,
                }}
              >
                <MathText text={b.content} />
              </div>
            </div>
          ))}

          {/* 当前题目（诊断态）+ AI 判题作答组件（M4r1，对齐 05 §5.1） */}
          {currentQuestion && (
            <div className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  当前题目（{currentQuestion.type === "choice" ? "选择" : currentQuestion.type === "blank" ? "填空" : "解答"}）
                </span>
                {judgeResult && (
                  <span className="text-xs" style={{ color: judgeResult.correct ? "var(--success)" : "var(--warn)" }}>
                    {judgeResult.correct ? "✓ 答对了" : "✗ 答错了"}
                    {judgeResult.method && `（${judgeResult.method === "llm" ? "AI 判题" : judgeResult.method === "choice" ? "选项比对" : "规则判定"}）`}
                  </span>
                )}
              </div>
              <MathText text={currentQuestion.content} />

              {judgeResult && (
                <p className="mt-2 text-sm" style={{ color: judgeResult.correct ? "var(--success)" : "var(--warn)" }}>
                  {judgeResult.feedback}
                </p>
              )}

              {/* 选择：选项按钮组 */}
              {currentQuestion.type === "choice" && currentQuestion.options && (
                <div className="mt-3 space-y-1.5">
                  {currentQuestion.options.map((o, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const active = selectedChoice === letter;
                    return (
                      <button
                        key={i}
                        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                        style={{
                          borderColor: active ? "var(--accent)" : "var(--border)",
                          background: active ? "var(--accent-soft)" : "transparent",
                          color: "var(--text)",
                        }}
                        onClick={() => setSelectedChoice(letter)}
                        disabled={loading}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium" style={{ background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--muted)" }}>
                          {letter}
                        </span>
                        <MathText text={o} />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 填空：单行输入 */}
              {currentQuestion.type === "blank" && (
                <input
                  className="mt-3 w-full rounded border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  placeholder="输入你的答案…"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && answerText.trim() && send("answer", answerText)}
                  disabled={loading}
                />
              )}

              {/* 解答：多行文本 */}
              {currentQuestion.type === "open" && (
                <textarea
                  className="mt-3 w-full rounded border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)", minHeight: 72 }}
                  placeholder="写出你的思路和答案…"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  disabled={loading}
                />
              )}

              <div className="mt-3 flex gap-2">
                <button
                  className="rounded px-4 py-1.5 text-sm text-white disabled:opacity-50"
                  style={{ background: "var(--accent)" }}
                  onClick={() => {
                    const ans = currentQuestion.type === "choice" ? selectedChoice : answerText;
                    if (ans?.trim()) send("answer", ans);
                  }}
                  disabled={loading || !((currentQuestion.type === "choice" ? selectedChoice : answerText.trim()))}
                >
                  提交答案
                </button>
                <span className="self-center text-xs" style={{ color: "var(--muted)" }}>
                  由 AI 判断对错
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* 输入区 */}
        <div className="flex shrink-0 gap-2 border-t p-3" style={{ borderColor: "var(--border)" }}>
          <input
            className="flex-1 rounded border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            placeholder={state === "elicit" || state === "identify" ? "说说你的思路…" : "继续对话…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send("message")}
          />
          <button className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--accent)" }} onClick={() => send("message")} disabled={loading}>
            发送
          </button>
        </div>
        {err && <p className="px-4 pb-2 text-xs text-red-600">{err}</p>}
      </div>

      {/* 右：图谱缩略（05 规范：会话页左右分栏） */}
      <aside className="hidden w-72 shrink-0 border-l p-4 md:block" style={{ borderColor: "var(--border)" }}>
        <div className="text-sm font-medium">学习路径预览</div>
        <div className="mt-3 space-y-1 text-xs" style={{ color: "var(--muted)" }}>
          <p>诊断完成后将显示推荐路径与图谱。</p>
          <p className="mt-2">四态状态：{STATES.find((s) => s.id === state)?.label}</p>
        </div>
      </aside>
    </div>
  );
}
