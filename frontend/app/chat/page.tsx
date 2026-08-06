"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, KeyItem, MessageReply, Question } from "@/lib/api";
import { useDomain } from "@/lib/domain";
import MathText from "@/components/Math";
import ConfirmDialog from "@/components/ConfirmDialog";

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
  // 会话管理（M4r7k：单删/批量删）
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // 删除确认弹窗（M4r15：替代原生 confirm——暗色主题下原生 confirm 黑底割裂）
  const [pendingDelete, setPendingDelete] = useState<{ ids: number[]; tip: string } | null>(null);
  // 领域学习空间（M4r8）
  const { active: activePack } = useDomain();
  // 未配 key 置灰（M4r17：AI 入口需有效 key，未配则置灰引导去设置页）
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const router = useRouter();
  // 开始页动态副标题（M4r7m）
  const [overview, setOverview] = useState<{ masteryPct: number | null; today: number; lastNode: string | null }>({
    masteryPct: null,
    today: 0,
    lastNode: null,
  });
  // 诊断配置面板（M4r5b）
  const [showConfig, setShowConfig] = useState(false);
  const [configType, setConfigType] = useState<"diagnostic" | "tutor">("diagnostic");
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

  // M4r17：加载 API key 状态（决定 AI 入口是否置灰）
  useEffect(() => {
    api<KeyItem[]>("/me/api-keys")
      .then((keys) => setHasKey(Array.isArray(keys) && keys.length > 0))
      .catch(() => setHasKey(false));
  }, []);

  // 开始页动态副标题：掌握度 / 今日题数 / 上次学习
  useEffect(() => {
    if (sessionId) return;
    (async () => {
      try {
        const me = await api<{ user_id: number }>("/auth/me");
        const qp = activePack ? `?pack_id=${activePack}` : "";
        const [m, t] = await Promise.all([
          api<{ mastery: Record<string, number> }>(`/api/v1/students/${me.user_id}/mastery${qp}`).catch(() => null),
          api<{ trend: { date: string; count: number }[] }>(`/api/v1/students/${me.user_id}/trend${qp}`).catch(() => null),
        ]);
        const entries = m?.mastery ? Object.entries(m.mastery) : [];
        const today = new Date().toISOString().slice(0, 10);
        const todayCount = t?.trend?.filter((x) => x.date === today).reduce((s, x) => s + x.count, 0) ?? 0;
        setOverview({
          masteryPct: entries.length ? Math.round((entries.reduce((s, [, p]) => s + p, 0) / entries.length) * 100) : null,
          today: todayCount,
          lastNode: null,
        });
      } catch {
        /* 未登录等静默 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, activePack]);

  async function startSession(type: "diagnostic" | "tutor") {
    setShowConfig(true); // 先配置再开始（诊断/辅导共用面板，M4r7h）
    setConfigType(type);
    if (type === "tutor" && ![1, 3, 5].includes(diagConfig.qcount)) {
      setDiagConfig((c) => ({ ...c, qcount: 1 })); // 辅导轮数默认 1
    }
  }

  async function createSession(type: "diagnostic" | "tutor", config?: DiagConfig) {
    setErr(null);
    setLoading(true);
    try {
      const body: any = { type };
      if (activePack) body.pack_id = activePack; // M4r8：按当前领域创建会话
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

  // M4r7k：删除会话（单删/批量删）——先弹站内确认，确认后执行
  async function deleteSessions(ids: number[]) {
    if (!ids.length) return;
    const deletingCurrent = !!sessionId && ids.includes(sessionId);
    const tip = deletingCurrent
      ? "（当前正在查看的会话将被删除并退出到开始页）"
      : "（删除后不可恢复）";
    // 站内弹窗确认（替代原生 confirm，M4r15）
    setPendingDelete({ ids, tip });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const ids = pendingDelete.ids;
    const deletingCurrent = !!sessionId && ids.includes(sessionId);
    setPendingDelete(null);
    try {
      await api<{ removed: number }>("/api/v1/sessions", { method: "DELETE", body: { ids } });
      // 若删除的是当前会话 → 退出
      if (deletingCurrent) {
        setSessionId(null);
        setActiveSessionId(null);
        setSessionType(null);
        setBubbles([]);
        setCurrentQuestion(null);
        setJudgeResult(null);
        setDiagProgress({});
      }
      setSelectedIds([]);
      setManageMode(false);
      await loadSessions();
    } catch (e: any) {
      setErr(e.message || "删除失败");
    }
  }

  // M4r7l：全选/取消全选
  function toggleSelectAll() {
    if (selectedIds.length === sessions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sessions.map((s) => s.id));
    }
  }

  const typeLabel = (t: string | null) => (t === "diagnostic" ? "诊断" : t === "tutor" ? "辅导" : t ?? "");

  return (
    <div className="flex h-full">
      {/* 会话历史侧栏（M4r5b）+ 管理（M4r7k） */}
      {sessionId && (
        <aside className="w-56 shrink-0 border-r p-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>历史会话</span>
            <div className="flex items-center gap-1">
              {manageMode ? (
                <>
                  <button className="text-xs" style={{ color: "var(--accent)" }} onClick={toggleSelectAll}>
                    {selectedIds.length === sessions.length ? "全不选" : "全选"}
                  </button>
                  <button className="text-xs" style={{ color: "var(--accent)" }} onClick={() => { setManageMode(false); setSelectedIds([]); }}>完成</button>
                  <button className="text-xs" style={{ color: selectedIds.length ? "#b3543c" : "var(--muted)" }} disabled={!selectedIds.length} onClick={() => deleteSessions(selectedIds)}>
                    删除({selectedIds.length})
                  </button>
                </>
              ) : (
                <>
                  <button className="text-xs" style={{ color: "var(--accent)" }} onClick={() => { setManageMode(true); setSelectedIds([]); }}>管理</button>
                  <button className="text-xs" style={{ color: "var(--accent)" }} onClick={loadSessions}>↻</button>
                </>
              )}
            </div>
          </div>
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id} className="group flex items-center gap-1">
                {manageMode ? (
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={selectedIds.includes(s.id)}
                    onChange={(e) =>
                      setSelectedIds((sel) =>
                        e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id),
                      )
                    }
                  />
                ) : (
                  <button
                    className="shrink-0 rounded p-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: "#b3543c" }}
                    title="删除此会话"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSessions([s.id]);
                    }}
                  >
                    ✕
                  </button>
                )}
                <button
                  className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors"
                  style={{
                    background: s.id === activeSessionId ? "var(--accent-soft)" : "transparent",
                    color: "var(--text)",
                  }}
                  onClick={() => (manageMode ? undefined : s.id === sessionId ? undefined : resumeSession(s.id))}
                >
                  <div className="flex justify-between">
                    <span>{typeLabel(s.type)} #{s.id}</span>
                    <span style={{ color: s.status === "completed" ? "var(--success)" : "var(--muted)" }}>
                      {s.status === "active" ? "进行中" : s.status === "completed" ? "已完成" : s.status}
                    </span>
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
          <div className="relative flex flex-1 items-center justify-center overflow-auto p-6">
            {/* 背景星点装饰（M4r7m） */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              {Array.from({ length: 18 }, (_, k) => (
                <span
                  key={k}
                  className="absolute rounded-full"
                  style={{
                    left: `${(k * 37) % 100}%`,
                    top: `${(k * 53) % 100}%`,
                    width: 2 + (k % 3),
                    height: 2 + (k % 3),
                    background: "var(--muted)",
                    opacity: 0.18 + ((k * 13) % 30) / 100,
                  }}
                />
              ))}
              <div
                className="absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full blur-3xl"
                style={{ background: "radial-gradient(circle, var(--accent-soft), transparent 70%)", opacity: 0.7 }}
              />
            </div>

            <div className="relative w-full max-w-2xl animate-fade">
              {/* 品牌标题区 */}
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--text)" }}>
                  今天想学点什么？
                </h1>
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  {overview.masteryPct !== null ? (
                    <>
                      掌握度 <span style={{ color: "var(--accent)" }}>{overview.masteryPct}%</span>
                      {overview.today > 0 && <> · 今日已练 <span style={{ color: "var(--accent)" }}>{overview.today}</span> 题</>}
                      {sessions.length > 0 && <> · 上次学到 {typeLabel(sessions[0].type)} #{sessions[0].id}</>}
                    </>
                  ) : (
                    "AI 将按 诊断 → 路径 → 讲解 → 练习 引导你"
                  )}
                </p>
              </div>

              {/* M4r17：未配 key 提示条 */}
              {hasKey === false && (
                <div
                  className="mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs"
                  style={{ borderColor: "var(--amber)", background: "var(--amber-soft)", color: "var(--text)" }}
                >
                  <span aria-hidden>🔑</span>
                  <span>
                    还没有配置 API key，AI 功能（诊断/辅导）暂不可用。
                    <button
                      className="ml-1 font-medium underline underline-offset-2"
                      style={{ color: "var(--accent)" }}
                      onClick={() => router.push("/settings")}
                    >
                      去设置页配置
                    </button>
                  </span>
                </div>
              )}

              {/* 双入口大卡（M4r7m） */}
              <div className="grid gap-4 md:grid-cols-2">
                <button
                  className="group rounded-2xl border p-5 text-left transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    background: "var(--surface)",
                    borderColor: "var(--border)",
                    opacity: hasKey === false ? 0.55 : 1,
                    cursor: hasKey === false ? "not-allowed" : "pointer",
                  }}
                  onClick={() => (hasKey === false ? router.push("/settings") : startSession("diagnostic"))}
                  disabled={loading || hasKey === false}
                >
                  <span
                    className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                  >
                    {/* 诊断：简约靶心线稿 */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                      <circle cx="12" cy="12" r="8.5" />
                      <circle cx="12" cy="12" r="4.5" />
                      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
                      <path d="M12 1.5 v4" />
                      <path d="M12 18.5 v4" />
                      <path d="M1.5 12 h4" />
                      <path d="M18.5 12 h4" />
                    </svg>
                  </span>
                  <div className="text-base font-medium" style={{ color: "var(--text)" }}>诊断测试</div>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                    {hasKey === false ? "需先配置 API key 才能使用" : "选择题型/题量/难度，定位薄弱知识点，生成学习路径"}
                  </div>
                  <span
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium transition-transform duration-200 group-hover:translate-x-0.5"
                    style={{ color: "var(--accent)" }}
                  >
                    {hasKey === false ? "去配置 →" : "开始 →"}
                  </span>
                </button>

                <button
                  className="group rounded-2xl border p-5 text-left transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    background: "var(--surface)",
                    borderColor: "var(--border)",
                    opacity: hasKey === false ? 0.55 : 1,
                    cursor: hasKey === false ? "not-allowed" : "pointer",
                  }}
                  onClick={() => (hasKey === false ? router.push("/settings") : startSession("tutor"))}
                  disabled={loading || hasKey === false}
                >
                  <span
                    className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
                    style={{ background: "var(--amber-soft)", color: "var(--amber)" }}
                  >
                    {/* 辅导：简约对话气泡线稿 */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 5 h16 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 h-9 l-5 4 v-4 h-2 a2 2 0 0 1 -2 -2 v-8 a2 2 0 0 1 2 -2 z" />
                      <path d="M8 10 h8" />
                      <path d="M8 13.5 h5" />
                    </svg>
                  </span>
                  <div className="text-base font-medium" style={{ color: "var(--text)" }}>辅导练习</div>
                  <div className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                    {hasKey === false ? "需先配置 API key 才能使用" : "苏格拉底式引导：只给提示，不给答案"}
                  </div>
                  <span
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium transition-transform duration-200 group-hover:translate-x-0.5"
                    style={{ color: "var(--amber)" }}
                  >
                    {hasKey === false ? "去配置 →" : "开始 →"}
                  </span>
                </button>
              </div>

              {/* 继续之前的对话（M4r7m：小卡列表） */}
              {sessions.length > 0 ? (
                <div className="mt-8">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>最近会话</span>
                  </div>
                  <div className="space-y-2">
                    {sessions.slice(0, 4).map((s) => (
                      <button
                        key={s.id}
                        className="flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all duration-200 hover:border-[color:var(--accent)]"
                        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                        onClick={() => resumeSession(s.id)}
                        disabled={loading}
                      >
                        <span
                          className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            background: s.type === "tutor" ? "var(--amber-soft)" : "var(--accent-soft)",
                            color: s.type === "tutor" ? "var(--amber)" : "var(--accent)",
                          }}
                        >
                          {typeLabel(s.type)}
                        </span>
                        <span className="flex-1 truncate text-xs" style={{ color: "var(--text)" }}>
                          会话 #{s.id}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--muted)" }}>
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: s.status === "completed" ? "var(--success)" : "var(--accent)" }}
                          />
                          {s.status === "active" ? "进行中" : "已完成"}
                          <span className="ml-1">
                            {new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </span>
                        <span aria-hidden className="text-xs" style={{ color: "var(--muted)" }}>›</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-8 rounded-xl border border-dashed px-4 py-6 text-center" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>还没有学习记录，从上方选择一种方式开始吧 ✨</p>
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

      {/* 配置面板（诊断/辅导共用，M4r7h） */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowConfig(false)}>
          <div className="w-full max-w-sm rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-base font-semibold">{configType === "tutor" ? "辅导配置" : "诊断配置"}</h2>

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
              <div className="mb-1.5 text-xs font-medium" style={{ color: "var(--muted)" }}>
                {configType === "tutor" ? "练习轮数" : "题量"}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(configType === "tutor" ? [1, 3, 5] : [5, 10, 15]).map((n) => (
                  <button
                    key={n}
                    className="rounded-lg border py-1.5 text-sm"
                    style={{ borderColor: diagConfig.qcount === n ? "var(--accent)" : "var(--border)", background: diagConfig.qcount === n ? "var(--accent-soft)" : "transparent" }}
                    onClick={() => setDiagConfig((c) => ({ ...c, qcount: n }))}
                  >
                    {n} {configType === "tutor" ? "轮" : "题"}
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
                  if (configType === "tutor") {
                    // 辅导：练习轮数默认 1（诊断默认 10 不串扰）
                    const cfg = { ...diagConfig, qcount: diagConfig.qcount };
                    createSession("tutor", cfg);
                  } else {
                    createSession("diagnostic", diagConfig);
                  }
                }}
              >
                {configType === "tutor" ? "开始辅导" : "开始诊断"}
              </button>
              <button className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--border)" }} onClick={() => setShowConfig(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗（M4r15：替代原生 confirm） */}
      {pendingDelete && (
        <ConfirmDialog
          title="删除会话"
          message={`确认删除 ${pendingDelete.ids.length} 个会话？${pendingDelete.tip}`}
          confirmText="确认删除"
          cancelText="取消"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
