"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, MessageReply, Question } from "@/lib/api";
import MathText from "@/components/Math";

interface Bubble {
  role: "user" | "assistant";
  content: string;
  state?: string;
}

interface SessionItem {
  id: number;
  type: string;
  status: string;
  created_at: string;
}

interface DiagConfig {
  qtypes: string[];
  qcount: number;
  difficulty: string;
}

const QTYPE_LABELS: Record<string, string> = { choice: "选择题", blank: "填空题", open: "解答题" };

const DEFAULT_DIAG: DiagConfig = { qtypes: ["choice", "blank", "open"], qcount: 10, difficulty: "auto" };

/** 对话学习（M4r5b）：会话历史侧栏（恢复继续）+ 诊断配置面板 + AI 判题 + 正确答案展示 */
export default function ChatPage() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [state, setState] = useState("elicit");
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // AI 判题
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [judgeResult, setJudgeResult] = useState<{ correct: boolean; feedback: string; method?: string; correctAnswer?: string | null } | null>(null);
  const [diagProgress, setDiagProgress] = useState<{ qcount?: number; answered?: number }>({});
  // 会话历史（M4r5b）
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  // 诊断配置面板（M4r5b）
  const [showConfig, setShowConfig] = useState(false);
  const [diagConfig, setDiagConfig] = useState<DiagConfig>(() => {
    try {
      const saved = localStorage.getItem("diag_config");
      return saved ? { ...DEFAULT_DIAG, ...JSON.parse(saved) } : DEFAULT_DIAG;
    } catch {
      return DEFAULT_DIAG;
    }
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bubbles, currentQuestion]);

  // 加载会话历史列表
  const loadSessions = useCallback(async () => {
    try {
      const r = await api<{ sessions: SessionItem[] }>("/api/v1/sessions");
      setSessions(r.sessions || []);
    } catch {
      /* 未登录等由页面级处理 */
    }
  }, []);
  useEffect(() => {
    loadSessions();
  }, [loadSessions, sessionId]);

  async function startSession(type: "diagnostic" | "tutor") {
    if (type === "diagnostic") {
      setShowConfig(true); // 先配置再开始
      return;
    }
    setShowConfig(false);
    await createSession(type);
  }

  async function createSession(type: "diagnostic" | "tutor", config?: DiagConfig) {
    setErr(null);
    setLoading(true);
    try {
      const body: any = { type };
      if (type === "diagnostic" && config) {
        body.config = { qtypes: config.qtypes, qcount: config.qcount, difficulty: config.difficulty };
        localStorage.setItem("diag_config", JSON.stringify(config));
      }
      const r = await api<MessageReply & { session_id: number; first_message?: string | null; qcount?: number; answered?: number }>("/api/v1/sessions", { method: "POST", body });
      setSessionId(r.session_id);
      setActiveSessionId(r.session_id);
      setSessionType(type);
      setCurrentQuestion(r.question);
      setDiagProgress({ qcount: r.qcount, answered: r.answered });
      setBubbles([{ role: "assistant", content: r.first_message || "开始。", state: "elicit" }]);
      setSelectedChoice(null);
      setAnswerText("");
      setJudgeResult(null);
      await loadSessions();
    } catch (e: any) {
      setErr(e.message || "创建会话失败");
    } finally {
      setLoading(false);
    }
  }

  // M4r5b：恢复历史会话（继续之前的对话）
  async function resumeSession(id: number) {
    setErr(null);
    setLoading(true);
    try {
      const st = await api<{ session_id: number; type: string; state: string; question: Question | null; qcount?: number; answered?: number; done: boolean }>(`/api/v1/sessions/${id}/state`);
      const msgs = await api<{ id: number; role: string; content: string; state?: string }[]>(`/api/v1/sessions/${id}/messages`).catch(() => []);
      setSessionId(id);
      setActiveSessionId(id);
      setSessionType(st.type);
      setState(st.state);
      setCurrentQuestion(st.question && !st.done ? st.question : null);
      setDiagProgress({ qcount: st.qcount, answered: st.answered });
      setBubbles(
        msgs.map((m) => ({ role: m.role as "user" | "assistant", content: m.content, state: m.state })),
      );
      setSelectedChoice(null);
      setAnswerText("");
      setJudgeResult(null);
    } catch (e: any) {
      setErr(e.message || "恢复会话失败");
    } finally {
      setLoading(false);
    }
  }

  async function send(kind: "answer" | "message", answer?: string) {
    if (!sessionId || loading) return;
    setErr(null);
    setLoading(true);
    try {
      const userText = kind === "answer" ? (answer ?? "").trim() || "作答" : input.trim();
      if (kind === "message" && input.trim()) setInput("");

      const body = kind === "answer" ? { kind, answer: (answer ?? "").trim() } : { kind, content: userText || "继续" };

      const r = await api<MessageReply>(`/api/v1/sessions/${sessionId}/messages`, { method: "POST", body });

      setState(r.state);
      setCurrentQuestion(r.question);
      setDiagProgress({ qcount: r.qcount ?? diagProgress.qcount, answered: r.answered ?? diagProgress.answered });
      // AI 判题反馈（M4r1）+ 正确答案（M4r5）
      if (kind === "answer" && r.correct !== null) {
        setJudgeResult({
          correct: r.correct,
          feedback: r.feedback || "",
          method: r.judge_method || undefined,
          correctAnswer: r.correct_answer,
        });
        setBubbles((b) => [...b, { role: "user", content: userText }]);
        setBubbles((b) => [...b, { role: "assistant", content: `${r.correct ? "✓ 答对了" : "✗ 答错了"}：${r.feedback || ""}`, state: r.state }]);
      } else {
        setJudgeResult(null);
        setBubbles((b) => [...b, { role: "user", content: userText }]);
        setBubbles((b) => [...b, { role: "assistant", content: r.message, state: r.state }]);
      }
      setSelectedChoice(null);
      setAnswerText("");
    } catch (e: any) {
      setErr(e.message || "发送失败");
    } finally {
      setLoading(false);
    }
  }

  function exitSession() {
    setSessionId(null);
    setActiveSessionId(null);
    setSessionType(null);
    setBubbles([]);
    setCurrentQuestion(null);
    setJudgeResult(null);
    setDiagProgress({});
    loadSessions();
  }

  const typeLabel = (t: string | null) => (t === "diagnostic" ? "诊断" : t === "tutor" ? "辅导" : t ?? "");

  return (
    <div className="flex h-full">
      {/* 会话历史侧栏（M4r5b） */}
      {sessionId && (
        <aside className="w-56 shrink-0 border-r p-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>历史会话</span>
            <button className="text-xs" style={{ color: "var(--accent)" }} onClick={loadSessions}>↻</button>
          </div>
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors"
                  style={{
                    background: s.id === activeSessionId ? "var(--accent-soft)" : "transparent",
                    color: "var(--text)",
                  }}
                  onClick={() => (s.id === sessionId ? undefined : resumeSession(s.id))}
                >
                  <div className="flex justify-between">
                    <span>{typeLabel(s.type)} #{s.id}</span>
                    <span style={{ color: "var(--muted)" }}>{s.status === "active" ? "进行中" : s.status}</span>
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                    {new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="flex flex-1 flex-col">
        {!sessionId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-md space-y-3 p-6">
              <h1 className="text-lg font-semibold">开始一次学习</h1>
              <p className="text-sm" style={{ color: "var(--muted)" }}>AI 将按 诊断 → 路径 → 讲解 → 练习 引导你</p>
              <button className="w-full rounded-xl border p-4 text-left transition-colors hover:opacity-80" style={{ background: "var(--surface)", borderColor: "var(--border)" }} onClick={() => startSession("diagnostic")} disabled={loading}>
                <div className="text-sm font-medium">诊断测试</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>选择题型/题量/难度，定位薄弱知识点，生成学习路径</div>
              </button>
              <button className="w-full rounded-xl border p-4 text-left transition-colors hover:opacity-80" style={{ background: "var(--surface)", borderColor: "var(--border)" }} onClick={() => startSession("tutor")} disabled={loading}>
                <div className="text-sm font-medium">辅导练习</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>苏格拉底式引导：只给提示，不给答案</div>
              </button>
              {sessions.length > 0 && (
                <div className="pt-2">
                  <div className="mb-1 text-xs font-medium" style={{ color: "var(--muted)" }}>继续之前的对话</div>
                  <ul className="space-y-1">
                    {sessions.slice(0, 5).map((s) => (
                      <li key={s.id}>
                        <button className="w-full rounded-lg border px-3 py-1.5 text-left text-xs" style={{ borderColor: "var(--border)" }} onClick={() => resumeSession(s.id)} disabled={loading}>
                          {typeLabel(s.type)} #{s.id} · {new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
                <span className="font-medium" style={{ color: "var(--text)" }}>{typeLabel(sessionType)}会话</span>
                {diagProgress.qcount ? (
                  <span>{diagProgress.answered ?? 0} / {diagProgress.qcount} 题</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    {(["elicit", "identify", "hint", "verify", "done"] as const).map((s) => (
                      <span key={s} className="flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: state === s ? "var(--accent)" : "var(--border)" }} />
                        <span style={{ color: state === s ? "var(--accent)" : "var(--muted)" }}>
                          {{ elicit: "探明", identify: "识别", hint: "提示", verify: "变式", done: "完成" }[s]}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button className="text-xs" style={{ color: "var(--muted)" }} onClick={exitSession}>✕ 退出会话</button>
              </div>
            </div>

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
              {currentQuestion && (
                <div className="rounded-xl border p-4 animate-fade" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
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
                    <div className="mt-2 space-y-1 text-sm">
                      <p style={{ color: judgeResult.correct ? "var(--success)" : "var(--warn)" }}>{judgeResult.feedback}</p>
                      {/* M4r5：判错展示正确答案 */}
                      {!judgeResult.correct && judgeResult.correctAnswer && (
                        <p className="text-sm" style={{ color: "var(--text)" }}>
                          <span style={{ color: "var(--muted)" }}>正确答案：</span>
                          <MathText text={judgeResult.correctAnswer} />
                        </p>
                      )}
                    </div>
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
                        if (ans?.trim()) send("answer", ans!);
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

            <div className="border-t p-3" style={{ borderColor: "var(--border)" }}>
              {err && <p className="mb-2 text-xs text-red-500">{err}</p>}
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                  placeholder={currentQuestion ? "追问 AI（可选）…" : "输入你的想法…"}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && input.trim() && send("message")}
                  disabled={loading}
                />
                <button className="rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50" style={{ background: "var(--accent)" }} onClick={() => send("message")} disabled={loading || !input.trim()}>
                  发送
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 诊断配置面板（M4r5b 需求 1c） */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowConfig(false)}>
          <div className="w-full max-w-sm rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-base font-semibold">诊断配置</h2>

            <div className="mb-4">
              <div className="mb-1.5 text-xs font-medium" style={{ color: "var(--muted)" }}>题型（可多选）</div>
              <div className="space-y-1.5">
              {Object.entries(QTYPE_LABELS).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={diagConfig.qtypes.includes(k)}
                    onChange={(e) =>
                      setDiagConfig((c) => ({
                        ...c,
                        qtypes: e.target.checked ? [...c.qtypes, k] : c.qtypes.filter((t) => t !== k),
                      }))
                    }
                  />
                  {v}
                </label>
              ))}
              </div>
            </div>

            <div className="mb-4">
              <div className="mb-1.5 text-xs font-medium" style={{ color: "var(--muted)" }}>题量</div>
              <div className="grid grid-cols-3 gap-2">
                {[5, 10, 15].map((n) => (
                  <button
                    key={n}
                    className="rounded-lg border py-1.5 text-sm"
                    style={{ borderColor: diagConfig.qcount === n ? "var(--accent)" : "var(--border)", background: diagConfig.qcount === n ? "var(--accent-soft)" : "transparent" }}
                    onClick={() => setDiagConfig((c) => ({ ...c, qcount: n }))}
                  >
                    {n} 题
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-5">
              <div className="mb-1.5 text-xs font-medium" style={{ color: "var(--muted)" }}>难度</div>
              <div className="grid grid-cols-4 gap-2">
                {[["auto", "自适应"], ["easy", "简单"], ["medium", "中等"], ["hard", "困难"]].map(([k, v]) => (
                  <button
                    key={k}
                    className="rounded-lg border py-1.5 text-sm"
                    style={{ borderColor: diagConfig.difficulty === k ? "var(--accent)" : "var(--border)", background: diagConfig.difficulty === k ? "var(--accent-soft)" : "transparent" }}
                    onClick={() => setDiagConfig((c) => ({ ...c, difficulty: k }))}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
                disabled={loading || diagConfig.qtypes.length === 0}
                onClick={() => {
                  setShowConfig(false);
                  createSession("diagnostic", diagConfig);
                }}
              >
                开始诊断
              </button>
              <button className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => setShowConfig(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
