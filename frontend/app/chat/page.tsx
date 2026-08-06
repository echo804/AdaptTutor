"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, HintReply, KeyItem, MessageReply, Question } from "@/lib/api";
import { useDomain } from "@/lib/domain";
import MathText from "@/components/Math";
import ConfirmDialog from "@/components/ConfirmDialog";

/** 会话内一张抽卡：题目 + 作答结果（错题复盘式卡片浏览，M5） */
interface Card {
  qid: string;
  question: Question;
  userAnswer?: string;
  correct?: boolean | null;
  feedback?: string | null;
  correctAnswer?: string | null;
  state: string;       // 辅导状态机状态；诊断恒 "diagnose"
  answered: boolean;   // 已提交（可翻面看答案）
  done?: boolean;
  is_review?: boolean; // M5：错题复习题标记
}

interface SessionItem {
  id: number;
  type: string;
  status: string;
  created_at: string;
}

/** M5：GET /sessions/{sid}/cards 返回的历史卡（重建卡片栈用） */
interface SessionCard {
  qid: string;
  question: Question | null;
  user_answer?: string;
  correct?: boolean;
  state: string;
  answered: boolean;
}

interface DiagConfig {
  qtypes: string[];
  qcount: number;
  difficulty: string;
}

const QTYPE_LABELS: Record<string, string> = { choice: "选择题", blank: "填空题", open: "解答题", multi: "多选题" };

const DEFAULT_DIAG: DiagConfig = { qtypes: ["choice", "blank", "open", "multi"], qcount: 10, difficulty: "auto" }; // M4r24

/** 对话学习（M4r5b）：会话历史侧栏（恢复继续）+ 诊断配置面板 + AI 判题 + 正确答案展示 */
export default function ChatPage() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string | null>(null);
  // M5 抽卡：卡片栈 + 当前索引（上一张/下一张浏览，非对话流）
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [state, setState] = useState("elicit");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // AI 判题输入
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<string[]>([]); // M4r24 多选
  const [answerText, setAnswerText] = useState("");
  // M5 抽卡：翻转状态 + 灯泡弹窗
  const [flipped, setFlipped] = useState(false);
  const [bulbOpen, setBulbOpen] = useState(false);
  const [bulbHint, setBulbHint] = useState<string | null>(null);
  const [bulbLoading, setBulbLoading] = useState(false);
  const [diagProgress, setDiagProgress] = useState<{ qcount?: number; answered?: number }>({});
  // M5：辅导进度（新题数/总题量/剩余错题）
  const [tutorProgress, setTutorProgress] = useState<{ practice: number; total: number; review_left: number } | null>(null);
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
  // M5 抽卡：派生当前卡与辅助判定
  const currentCard = cards[currentIdx] ?? null;
  const isTutor = sessionType === "tutor";
  const isLatest = currentIdx === cards.length - 1;

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
    // M4r21f：不再把 diagConfig.qcount 改成 1（此前辅导"轮数默认 1"污染诊断题量，
    // 导致点过辅导后诊断也变成 1 题就结束）；辅导轮数在创建时单独传（见"开始辅导"）
  }

  async function createSession(type: "diagnostic" | "tutor", config?: DiagConfig) {
    setErr(null);
    setLoading(true);
    try {
      const body: any = { type };
      if (activePack) body.pack_id = activePack; // M4r8：按当前领域创建会话
      if (config) {
        // M4r21f：诊断传题量/题型/难度；辅导传轮数（qcount=轮数）
        body.config = { qtypes: config.qtypes, qcount: config.qcount, difficulty: config.difficulty };
        if (type === "diagnostic") localStorage.setItem("diag_config", JSON.stringify(config));
      }
      const r = await api<MessageReply & { session_id: number; first_message?: string | null; qcount?: number; answered?: number }>("/api/v1/sessions", { method: "POST", body });
      setSessionId(r.session_id);
      setActiveSessionId(r.session_id);
      setSessionType(type);
      setState(type === "tutor" ? "elicit" : "diagnose");
      // M5 抽卡：首题入栈为第一张卡
      setCards(
        r.question
          ? [{ qid: r.question.id, question: r.question, state: type === "tutor" ? "elicit" : "diagnose", answered: false }]
          : [],
      );
      setCurrentIdx(0);
      setDiagProgress({ qcount: r.qcount, answered: r.answered });
      setFlipped(false);
      setSelectedChoice(null);
      setSelectedMulti([]); // M4r24
      setAnswerText("");
      await loadSessions();
    } catch (e: any) {
      setErr(e.message || "创建会话失败");
    } finally {
      setLoading(false);
    }
  }

  // M4r5b：恢复历史会话（M5 抽卡：调 /cards 重建完整卡片栈，可回看历史卡）
  async function resumeSession(id: number) {
    setErr(null);
    setLoading(true);
    try {
      const st = await api<{ session_id: number; type: string; state: string; question: Question | null; verify_question?: Question | null; qcount?: number; answered?: number; done: boolean }>(`/api/v1/sessions/${id}/state`);
      const cardsR = await api<{ items: SessionCard[]; done: boolean }>(`/api/v1/sessions/${id}/cards`).catch(() => null);
      setSessionId(id);
      setActiveSessionId(id);
      setSessionType(st.type);
      setState(st.state);
      // M5 抽卡：优先用 /cards 重建完整卡片栈（已答卡可翻面回看）；失败/为空时回退为当前题单卡
      let cards0: Card[] = [];
      if (cardsR && cardsR.items.length) {
        cards0 = cardsR.items.map((c) => ({
          qid: c.qid,
          question:
            c.question ??
            ({ id: c.qid, type: "blank", content: "（内容未保存）", difficulty: 0.5 } as Question),
          userAnswer: c.user_answer,
          correct: c.correct,
          state: c.state,
          answered: c.answered,
          done: cardsR.done,
        }));
      }
      if (!cards0.length) {
        // M4r21c：辅导会话的当前题在 verify_question 字段（question 仅诊断用），两者都兼容
        const curQ = st.type === "tutor" ? (st.verify_question ?? st.question) : st.question;
        cards0 = curQ && !st.done ? [{ qid: curQ.id, question: curQ, state: st.state, answered: false }] : [];
      }
      setCards(cards0);
      // 恢复到最新一张（正在作答的卡）
      setCurrentIdx(cards0.length ? cards0.length - 1 : 0);
      setDiagProgress({ qcount: st.qcount, answered: st.answered });
      setFlipped(false);
      setBulbOpen(false);
      setSelectedChoice(null);
      setSelectedMulti([]); // M4r24
      setAnswerText("");
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
      const userText = kind === "answer" ? (answer ?? "").trim() || "作答" : (answer ? String(answer).trim() : "继续");

      const body =
        kind === "answer"
          ? { kind, answer: (answer ?? "").trim() }
          // M4r24f：辅导会话作答也走 message——若显式传 answer（选项/填空提交），用它作为 content
          : answer
            ? { kind, content: String(answer).trim() }
            : { kind, content: userText || "继续" };

      const r = await api<MessageReply>(`/api/v1/sessions/${sessionId}/messages`, { method: "POST", body });

      setState(r.state);
      setTutorProgress((r.context?.progress as { practice: number; total: number; review_left: number } | null | undefined) ?? null);
      setDiagProgress({ qcount: r.qcount ?? diagProgress.qcount, answered: r.answered ?? diagProgress.answered });

      // M5 抽卡：卡片栈更新（上一张/下一张浏览的数据源）
      const cur = cards[currentIdx] ?? null;
      const judged = r.correct !== null;
      const newQ = r.question;
      const sameQ = !!newQ && !!cur && newQ.id === cur.qid;

      const updatedCur: Card | null = cur
        ? {
            ...cur,
            answered: cur.answered || judged,
            state: r.state,
            correct: judged ? r.correct : cur.correct,
            feedback: judged ? (r.feedback ?? undefined) : cur.feedback,
            correctAnswer: judged ? (r.correct_answer ?? undefined) : cur.correctAnswer,
            userAnswer: judged ? (cur.userAnswer ?? userText) : cur.userAnswer,
            done: !!r.done || !!cur.done,
          }
        : null;

      let next = [...cards];
      if (cur && updatedCur) next[currentIdx] = updatedCur;
      let pushed = false;
      if (newQ && !sameQ) {
        next = [...next, { qid: newQ.id, question: newQ, state: r.state, answered: false, is_review: !!r.context?.is_review }];
        pushed = true;
      }
      setCards(next);

      if (judged) {
        // 作答完成：出现新题/会话完成 → 自动翻面看答案（停留当前卡，点"下一张"到新卡）；
        // 辅导同题多轮（identify/hint 重定位）→ 不翻面，正面继续
        setFlipped(!sameQ || !!r.done);
      } else if (pushed) {
        // 非判题推进（如"去验证"）返回新题 → 直接跳到新卡正面
        setFlipped(false);
        setCurrentIdx((i) => i + 1);
      }
      setSelectedChoice(null);
      setSelectedMulti([]); // M4r24
      setAnswerText("");
    } catch (e: any) {
      setErr(e.message || "发送失败");
    } finally {
      setLoading(false);
    }
  }

  // M5 卡片流：结构化快捷动作（替代自由文本输入，减少歧义）
  const goVerify = () => send("message", "好，我试试");

  // M5 抽卡：灯泡求助（弹窗显示 AI 简短讲解/提示，不推进状态机）
  const openBulb = async () => {
    if (!sessionId || loading) return;
    setBulbOpen(true);
    setBulbLoading(true);
    setBulbHint(null);
    try {
      const r = await api<HintReply>(`/api/v1/sessions/${sessionId}/hint`, { method: "POST" });
      setBulbHint(r.hint);
    } catch (e: any) {
      setBulbHint(e.message || "生成提示失败，稍后再试");
    } finally {
      setBulbLoading(false);
    }
  };

  // M5 抽卡：提交辅助（按当前卡题型校验并发送）
  const q = currentCard?.question;
  const canSubmit = !!q && (q.type === "choice" ? !!selectedChoice : q.type === "multi" ? selectedMulti.length > 0 : !!answerText.trim());
  const submitAnswer = () => {
    if (!currentCard || !canSubmit || loading) return;
    const q0 = currentCard.question;
    const ans = q0.type === "choice" ? selectedChoice! : q0.type === "multi" ? selectedMulti.join(",") : answerText;
    send(isTutor ? "message" : "answer", ans!);
  };

  function exitSession() {
    setSessionId(null);
    setActiveSessionId(null);
    setSessionType(null);
    setCards([]);
    setCurrentIdx(0);
    setDiagProgress({});
    setFlipped(false);
    setBulbOpen(false);
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
        setCards([]);
        setCurrentIdx(0);
        setDiagProgress({});
        setFlipped(false);
        setBulbOpen(false);
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
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
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
                    style={{ color: "var(--accent)" }}
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
                            background: "var(--accent-soft)",
                            color: "var(--accent)",
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

            {/* M5 抽卡：卡片浏览（错题复盘式，非对话流） */}
            <div className="flex-1 overflow-auto p-4">
              {/* 顶部：辅导进度（新题 N/总 · 剩余错题） + 卡片计数 */}
              <div className="mb-4 flex items-center justify-between">
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {isTutor && tutorProgress && (
                    <>
                      新题 {tutorProgress.practice}/{tutorProgress.total}
                      {tutorProgress.review_left > 0 ? ` · 错题复习 ${tutorProgress.review_left}` : ""}
                    </>
                  )}
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {cards.length > 0 ? `${currentIdx + 1} / ${cards.length} 张` : "0 张"}
                </div>
              </div>
              {err && <p className="mb-2 text-xs text-red-500">{err}</p>}

              {!currentCard ? (
                <div className="mx-auto max-w-xl rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--border)" }}>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {sessionType === "diagnostic" ? "诊断完成 🎉 可去报告页查看结果" : "本轮辅导完成 🎉"}
                  </p>
                </div>
              ) : (
                <>
                  {/* 翻转卡（点击翻面看答案） */}
                  <div
                    className="mx-auto max-w-xl [perspective:1200px]"
                    onClick={() => {
                      if (currentCard.answered) setFlipped((f) => !f);
                    }}
                  >
                    <div
                      className="relative h-[460px] w-full transition-transform duration-500 [transform-style:preserve-3d]"
                      style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", cursor: currentCard.answered ? "pointer" : "default" }}
                    >
                      {/* 正面：题目 + 作答 */}
                      <div
                        className="absolute inset-0 flex flex-col rounded-2xl border p-5 [backface-visibility:hidden]"
                        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                              {QTYPE_LABELS[currentCard.question.type] || "题目"}
                            </span>
                            {isTutor && currentCard.state === "verify" && (
                              <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                                变式验证
                              </span>
                            )}
                            {isTutor && currentCard.state === "identify" && (
                              <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--amber-soft)", color: "var(--text)" }}>
                                定位重试
                              </span>
                            )}
                            {/* M5：错题复习题标记 */}
                            {currentCard.is_review && (
                              <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--amber-soft)", color: "#b3543c" }}>
                                复习
                              </span>
                            )}
                          </div>
                          {/* 灯泡（仅辅导最新卡） */}
                          {isTutor && isLatest && (
                            <button
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm transition-transform hover:scale-110 disabled:opacity-50"
                              style={{ borderColor: "var(--amber)", background: "var(--amber-soft)" }}
                              onClick={(e) => { e.stopPropagation(); openBulb(); }}
                              title="求助提示"
                              disabled={bulbLoading}
                            >
                              💡
                            </button>
                          )}
                        </div>

                        {/* 内容滚动区（固定高度下超长题目/选项卡内滚动，不撑破卡片） */}
                        <div className="flex-1 overflow-y-auto pr-1">
                          <div className="text-[15px] leading-relaxed">
                            <MathText text={currentCard.question.content} />
                          </div>
                          {/* 只读选项：仅历史卡/已答卡展示（作答中的卡由交互区按钮组呈现，避免选项重复） */}
                          {!(isLatest && !currentCard.answered) && (currentCard.question.type === "choice" || currentCard.question.type === "multi") && currentCard.question.options && (
                            <div className="mt-3 space-y-1">
                              {currentCard.question.options.map((o, i) => {
                                const clean = typeof o === "string" ? o.replace(/^[A-Z][\.．、]\s*/, "") : o;
                                return (
                                  <div key={i} className="text-sm">
                                    {String.fromCharCode(65 + i)}. <MathText text={clean} />
                                  </div>
                                );
                              })}
                            </div>
                          )}

                        {/* 作答交互区：最新未提交卡；hint 态给"去验证" */}
                        {isLatest && !currentCard.answered ? (
                          currentCard.state === "hint" ? (
                            <div className="mt-3 space-y-3">
                              <p className="text-xs" style={{ color: "var(--muted)" }}>提示已放 💡 里，看看思路后继续。</p>
                              <button
                                className="rounded px-4 py-1.5 text-sm text-white disabled:opacity-50"
                                style={{ background: "var(--accent)" }}
                                onClick={(e) => { e.stopPropagation(); goVerify(); }}
                                disabled={loading}
                              >
                                继续下一题 →
                              </button>
                            </div>
                          ) : (
                            <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                              {currentCard.question.type === "blank" && (
                                <input
                                  className="w-full rounded border px-3 py-2 text-sm outline-none"
                                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                                  placeholder="输入你的答案…"
                                  value={answerText}
                                  onChange={(e) => setAnswerText(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && answerText.trim() && submitAnswer()}
                                  disabled={loading}
                                />
                              )}
                              {currentCard.question.type === "open" && (
                                <textarea
                                  className="w-full rounded border px-3 py-2 text-sm outline-none"
                                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)", minHeight: 72 }}
                                  placeholder="写出你的思路和答案…"
                                  value={answerText}
                                  onChange={(e) => setAnswerText(e.target.value)}
                                  disabled={loading}
                                />
                              )}
                              {(currentCard.question.type === "choice" || currentCard.question.type === "multi") && currentCard.question.options && (
                                <div className="space-y-1.5">
                                  {/* M4r24：多选题标注（可多选，全部选对才算对） */}
                                  {currentCard.question.type === "multi" && (
                                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                                      （可多选，全部选对才算对）
                                    </p>
                                  )}
                                  {currentCard.question.options.map((o, i) => {
                                    const letter = String.fromCharCode(65 + i);
                                    const clean = typeof o === "string" ? o.replace(/^[A-Z][\.．、]\s*/, "") : o;
                                    const active = currentCard.question.type === "multi" ? selectedMulti.includes(letter) : selectedChoice === letter;
                                    return (
                                      <button
                                        key={i}
                                        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                                        style={{
                                          borderColor: active ? "var(--accent)" : "var(--border)",
                                          background: active ? "var(--accent-soft)" : "transparent",
                                          color: "var(--text)",
                                        }}
                                        onClick={() =>
                                          currentCard.question.type === "multi"
                                            ? setSelectedMulti((prev) => prev.includes(letter) ? prev.filter((x) => x !== letter) : [...prev, letter])
                                            : setSelectedChoice(letter)
                                        }
                                        disabled={loading}
                                      >
                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium" style={{ background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--muted)" }}>
                                          {letter}
                                        </span>
                                        <MathText text={clean} />
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              <div className="mt-3 flex justify-end">
                                <button
                                  className="rounded px-4 py-1.5 text-sm text-white disabled:opacity-50"
                                  style={{ background: "var(--accent)" }}
                                  onClick={() => submitAnswer()}
                                  disabled={loading || !canSubmit}
                                >
                                  提交答案
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="mt-3 text-center text-xs" style={{ color: "var(--muted)" }}>
                            {currentCard.answered ? "点击卡片翻面看答案" : ""}
                          </div>
                        )}
                        </div>
                      </div>

                      {/* 背面：我的答案 vs 正确答案 */}
                      <div
                        className="absolute inset-0 flex flex-col rounded-2xl border p-5 [backface-visibility:hidden] [transform:rotateY(180deg)]"
                        style={{ background: "var(--surface)", borderColor: currentCard.correct ? "var(--success)" : "var(--border)" }}
                      >
                        {currentCard.answered ? (
                          <>
                            <div className="mb-3 flex items-center justify-between">
                              <span className="text-sm font-medium" style={{ color: currentCard.correct ? "var(--success)" : "#b3543c" }}>
                                {currentCard.correct ? "✓ 答对了" : "✗ 答错了"}
                              </span>
                              <span className="text-xs" style={{ color: "var(--muted)" }}>点击翻回题目</span>
                            </div>
                            <div className="flex-1 space-y-3 overflow-y-auto pr-1 text-sm">
                              <div>
                                <div className="mb-1 text-xs" style={{ color: "var(--warn)" }}>我的答案</div>
                                <MathText text={currentCard.userAnswer || "（未作答）"} />
                              </div>
                              <div>
                                <div className="mb-1 text-xs" style={{ color: "var(--success)" }}>正确答案</div>
                                <MathText text={currentCard.correctAnswer || "—"} />
                              </div>
                              {currentCard.feedback && (
                                <div className="text-xs" style={{ color: "var(--muted)" }}>{currentCard.feedback}</div>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="m-auto text-sm" style={{ color: "var(--muted)" }}>先作答，提交后翻面看答案</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 操作栏：上一张 / 下一张 */}
                  <div className="mx-auto mt-5 flex max-w-xl items-center justify-center gap-3">
                    <button
                      className="rounded-lg border px-5 py-2 text-sm disabled:opacity-40"
                      style={{ borderColor: "var(--border)" }}
                      onClick={() => { setFlipped(false); setCurrentIdx((i) => Math.max(0, i - 1)); }}
                      disabled={currentIdx === 0 || loading}
                    >
                      ← 上一张
                    </button>
                    <button
                      className="rounded-lg px-5 py-2 text-sm text-white disabled:opacity-40"
                      style={{ background: "var(--accent)" }}
                      onClick={() => { setFlipped(false); setCurrentIdx((i) => Math.min(cards.length - 1, i + 1)); }}
                      disabled={currentIdx >= cards.length - 1 || loading}
                    >
                      下一张 →
                    </button>
                  </div>
                  <p className="mt-3 text-center text-xs" style={{ color: "var(--muted)" }}>
                    {isTutor ? "答错的题会引导巩固 · 点 💡 可求助" : "作答后自动翻面 · 可随时回看上一张"}
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* M5 抽卡：灯泡求助弹窗（AI 简短讲解/提示） */}
      {bulbOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBulbOpen(false)}>
          <div className="w-full max-w-md rounded-xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--amber)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">💡 求助提示</span>
              <button className="text-xs" style={{ color: "var(--muted)" }} onClick={() => setBulbOpen(false)}>✕</button>
            </div>
            <div className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--text)" }}>
              {bulbLoading ? "思考中…" : <MathText text={bulbHint ?? ""} />}
            </div>
          </div>
        </div>
      )}

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
                题目数量
              </div>
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
                  // M5：辅导也支持自定义题目数量（qcount=题量=巩固的知识点数，错题当场变式加强）
                  createSession(configType === "tutor" ? "tutor" : "diagnostic", diagConfig);
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



