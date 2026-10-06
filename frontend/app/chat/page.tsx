"use client";

// M6.1：生产部署——交互页不做静态预渲染（prerender 会执行模块级浏览器依赖导致构建失败）
export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, HintReply, KeyItem, MessageReply, Question } from "@/lib/api";
import { useDomain } from "@/lib/domain";
import MathText from "@/components/Math";
import ConfirmDialog from "@/components/ConfirmDialog";

/**
 * 对话流里的一条消息（A 刀 · 替换原 `interface Card`）
 *
 * 为什么要换掉 Card：原 Card 的 `answered` 一个字段同时表达
 * "判过分"和"本轮结束"两件事，而 `correct=false` 在后端有三种含义
 * （真答错 / 诊断不支持追问 / VERIFY 非答案输入），于是前端一律
 * 把它当成"结束"→ 关掉作答区 → 死锁。拆成 msgs + closed 才分得开。
 */
interface Msg {
  role: "ai" | "me";
  text: string;
  /** 判题结论（仅 role==="me" 且本轮确实判过分时有） */
  verdict?: { correct: boolean; answer?: string | null; feedback?: string | null };
  /** 需要认真对待的追问 → 主强调色 + 左侧细竖线（05 §5.1） */
  probe?: boolean;
}

interface SessionItem {
  id: number;
  type: string;
  status: string;
  created_at: string;
}

/** GET /sessions/{sid}/messages 返回的历史消息（A6 用它重建对话流） */
interface MessageOut {
  id: number;
  role: string;
  content: string;
  trace_id: string;
  created_at: string;
}

interface DiagConfig {
  qtypes: string[];
  qcount: number;
  difficulty: string;
}

const QTYPE_LABELS: Record<string, string> = { choice: "选择题", blank: "填空题", open: "解答题", multi: "多选题" };

const DEFAULT_DIAG: DiagConfig = { qtypes: ["choice", "blank", "open", "multi"], qcount: 10, difficulty: "auto" }; // M4r24

/** 对话学习（M4r5b）：会话历史侧栏（恢复继续）+ 诊断配置面板 + AI 判题 + 正确答案展示 */
function ChatPageInner() {
  // M6：?sid= 直达会话（复习中心「开始复习」跳转）
  const searchParams = useSearchParams();
  const sidParam = searchParams.get("sid");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionType, setSessionType] = useState<string | null>(null);
  // A 刀：对话流状态（替换原 M5 卡片栈 cards/currentIdx/flipped）
  const [msgs, setMsgs] = useState<Msg[]>([]);          // 可见的对话流
  const [question, setQuestion] = useState<Question | null>(null); // 当前待作答的题
  // 已终结的题号集合 —— 按题记录，而不是一个全局 closed 开关。
  // 原因：换题时旧规则 setClosed(true) 会把"新题"也一起锁掉，导致
  // 用户答对一道题后新题无法作答（必须刷新/重进才恢复）。
  const [closedQids, setClosedQids] = useState<Set<string>>(new Set());
  const [sessionOver, setSessionOver] = useState(false); // 本轮彻底结束（done/换到末尾）→ 只读
  const [unlocked, setUnlocked] = useState<{ answer: string | null; qid: string } | null>(null); // 终结后才放出的标准答案
  const [gateOpen, setGateOpen] = useState(false);      // 答案闸门是否解锁
  const [qIndex, setQIndex] = useState<{ no: number; total: number } | null>(null); // 第几题 / 共几题
  const [draftMode, setDraftMode] = useState(false);     // 输入框处于草稿态（不提交、不判分）
  const [isReview, setIsReview] = useState(false);      // 当前题是错题复习题
  const [state, setState] = useState("elicit");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // AI 判题输入
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [selectedMulti, setSelectedMulti] = useState<string[]>([]); // M4r24 多选
  const [answerText, setAnswerText] = useState("");
  // M5 抽卡：灯泡弹窗
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
  // A 刀：派生当前题是否已结束（对话流没有"翻面"，只有终结与否）
  // closed 由 closedQids 按题号判定，sessionOver 表示本轮彻底结束
  const closed = !!question && (closedQids.has(question.id) || sessionOver);
  const finished = sessionOver && !question;
  const isTutor = sessionType === "tutor";
  // A16：对话流自动滚到最新一条
  const flowEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    flowEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs.length, loading]);

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

  // M6：URL 带 ?sid= → 自动恢复该会话（复习中心/外部直达）
  const autoResumed = useRef(false);
  useEffect(() => {
    if (autoResumed.current || !sidParam || sessionId) return;
    const n = Number(sidParam);
    if (!Number.isFinite(n) || n <= 0) return;
    autoResumed.current = true;
    resumeSession(n);
  }, [sidParam, sessionId]);

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
      // A 刀：开场白 + 出题作为消息入流（不再是"第一张卡"）
      const opening = r.first_message?.trim();
      const flow: Msg[] = opening ? [{ role: "ai", text: opening }] : [];
      setMsgs(flow);
      setQuestion(r.question ?? null);
      // 新会话没有已终结的旧题；只有拿不到题时才算本轮结束
      setClosedQids(new Set());
      setSessionOver(!r.question);
      setUnlocked(null);
      setGateOpen(false);
      // 新会话直接进作答态：草稿态会藏起选项与输入框，学生看不到题只能干等
      setDraftMode(false);
      setIsReview(false);
      setDiagProgress({ qcount: r.qcount, answered: r.answered });
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

  // A 刀：把后端 `message`（判题行 + "\n" + 引导语）拆成判词与引导语两部分。
// TODO(B 刀)：这是临时启发式 —— 后端把两段拼在同一个字段里（routes_sessions.py:403）。
// B 刀给 MessageReply 加 `kind: verdict|coach` 后，这里应改为按 kind 分流并删掉本函数。
const JUDGE_LINE_RE = /^[✓✗]/;

/** 从 Set 里移除一个 key，返回新 Set（React 状态需要新引用才能触发重渲染） */
function removeFrom(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

/** 从一条 assistant 消息文本还原出判词与引导语 */
function splitAssistant(text: string): { verdictText: string | null; coach: string } {
  const lines = text.split("\n");
  if (!JUDGE_LINE_RE.test(lines[0] ?? "")) return { verdictText: null, coach: text };
  const verdictText = lines[0];
  const coach = lines.slice(1).join("\n").trim();
  return { verdictText, coach };
}

/** 从判题行还原判对错与标准答案（"✗ 答错了，正确答案是：X。"） */
function parseVerdictLine(line: string): { correct: boolean; answer: string | null } {
  if (line.startsWith("✓")) return { correct: true, answer: null };
  const m = line.match(/正确答案是[：:]\s*(.+?)[。.]?\s*$/);
  return { correct: false, answer: m ? m[1] : null };
}

interface HistoryTurn {
  verdict?: { correct: boolean; answer?: string | null };
  answered: boolean;
  done: boolean;
  unlocked: { answer: string | null; qid: string } | null;
}

/**
 * A 刀：恢复历史会话 —— 调 GET /sessions/{sid}/messages 重建对话流。
 * 这个接口此前从未被前端调用过（全仓 grep 0 处），接上它就有了"思路轨迹回看"。
 */
async function resumeSession(id: number) {
  setErr(null);
    setLoading(true);
    try {
      const st = await api<{ session_id: number; type: string; state: string; question: Question | null; verify_question?: Question | null; qcount?: number; answered?: number; done: boolean }>(`/api/v1/sessions/${id}/state`);
      // A6：用历史消息重建对话流（失败不阻塞，仍可用当前题单条渲染）
      const hist = await api<MessageOut[]>(`/api/v1/sessions/${id}/messages`).catch(() => null);
      setSessionId(id);
      setActiveSessionId(id);
      setSessionType(st.type);
      setState(st.state);

      const flow: Msg[] = [];
      let turn: HistoryTurn = { answered: false, done: false, unlocked: null };
      if (hist && hist.length) {
        for (const m of hist) {
          if (m.role === "user") {
            flow.push({ role: "me", text: m.content });
            turn.answered = false;
            turn.unlocked = null;
            continue;
          }
          // assistant：判题行 + 引导语
          const { verdictText, coach } = splitAssistant(m.content);
          if (verdictText) {
            const v = parseVerdictLine(verdictText);
            turn.answered = true;
            turn.verdict = { correct: v.correct, answer: v.answer };
            // 历史轮次的答案按 7.8 裁决显示（那题已终结），只锁"当前未终结题"
            turn.unlocked = { answer: v.answer ?? null, qid: "" };
            // 判词挂回学生那条（与 send() 里的处理一致）
            for (let i = flow.length - 1; i >= 0; i--) {
              if (flow[i].role === "me") {
                flow[i] = { ...flow[i], verdict: { correct: v.correct, answer: v.answer, feedback: null } };
                break;
              }
            }
          }
          if (coach) flow.push({ role: "ai", text: coach, probe: !verdictText });
        }
      }

      // M4r21c：辅导会话的当前题在 verify_question 字段（question 仅诊断用），两者都兼容
      const curQ = st.type === "tutor" ? (st.verify_question ?? st.question) : st.question;
      setMsgs(flow);
      setQuestion(curQ ?? null);
      // 当前题是否已终结 —— 以服务端 state 为唯一依据。
      // 不能用"历史最后一条是否是判题行"（turn.answered）来判断：变式题答对后
      // 状态机已推进到下一题（state=elicit + 新 qid），但历史最后一条恰好是判题行，
      // 那样会把新的待答题误判成已终结 → 作答区消失 → 用户看到题却答不了。
      const isDone = !!st.done || st.state === "done";
      // 当前题是否已终结，按题号判定。服务端 done 只说明「本轮结束」，
      // 若据此把当前题也锁上，恢复会话时会出现「题还在但答不了」。
      // 注意 sessionOver 只能由「本轮彻底结束」置位：若在 done=true 时把它也置上，
      // 而服务端仍带着一道待答题（curQ 非空），closed = closedQids.has(id) || sessionOver
      // 会让这道题一起被锁死 —— 学生看到题却点不动提交（用户反馈：变式题答对后无法作答）。
      const over = isDone && !curQ;
      setClosedQids(isDone && curQ ? new Set([curQ.id]) : new Set());
      setSessionOver(over);
      // 历史判题行仍可用于展示"已答过"，但不代表当前题终结。
      // 闸门只在「本轮彻底结束、没有待答题」时才放答案 ——
      // 有待答题却显示"✓ 本题已答对"，学生会以为新题已经答过了。
      setUnlocked(over ? turn.unlocked : null);
      setGateOpen(over && !!turn.unlocked);
      setDiagProgress({ qcount: st.qcount, answered: st.answered });
      setBulbOpen(false);
      setDraftMode(false);
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

      // ===== A7/A8：对话流更新（本刀的核心） =====
      // 判题事实由后端 judged 显式给出，不再从 correct !== null 推断
      // （correct=false 同时表示"真答错 / 非答案输入 / 诊断不支持追问"三种情况）。
      const judged = r.judged === true;
      const newQ = r.question;
      // sameQ：服务端又下发了同一道题（变式题用尽题库后可能回到原题）。
      // 此时题面/选项/答案完全一致，作答区应保持原样，但仍要清掉选择态与
      // "已答对"标记 —— 学生看到的是一道新题，不该被上一轮的记录影响。
      const sameQ = !!newQ && !!question && newQ.id === question.id;
      const pushed = !!newQ && !sameQ;                   // 换题 → 上一题终结
      const isDone = r.state === "done" || r.done === true;

      setMsgs((prev) => {
        const next = [...prev];
        // 学生这条
        next.push({ role: "me", text: userText });
        // 后端把"判题行 + 引导语"拼在同一个 message 里 —— 用 ^[✓✗] 前缀拆开。
        // TODO(B 刀)：临时启发式，契约清理后应按 kind 分流。
        const { verdictText, coach } = splitAssistant(r.message ?? "");
        // 判词挂到学生那条上（"我的答案 → 对不对"）
        if (judged) {
          const v = parseVerdictLine(verdictText || (r.correct ? "✓" : "✗"));
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "me") {
              next[i] = {
                ...next[i],
                verdict: {
                  correct: !!r.correct,
                  answer: r.correct ? null : (r.correct_answer ?? v.answer ?? null),
                  feedback: r.feedback ?? null,
                },
              };
              break;
            }
          }
        }
        // 引导语独立成消息：需要认真对待的追问用主强调色 + 左竖线（05 §5.1）
        if (coach) next.push({ role: "ai", text: coach, probe: !judged });
        return next;
      });

      // 服务端下发了新题（可能是换题，也可能是同一道题被重新下发）。
      // 两种情况都要清掉上一轮的选择态 —— 学生眼前是一道待答题，
      // 若还留着上次的勾选，会以为已经作答过了。
      // 闸门/答案的清理统一放在下面的终结判定里（判据是"是否下发了新题"）。
      if (newQ) {
        if (!sameQ) {
          setQuestion(newQ);
          // 只有 no 递增，total 由题量配置决定（此前 no/total 同步 +1，
          // 于是永远显示"第 2/2 题""第 3/3 题"——total 根本不是总题数）。
          // 服务端在 context.progress 里下发真实题量；拿不到就不显示 total。
          const total = (r.context?.progress as { total?: number } | null | undefined)?.total;
          setQIndex((prev) => ({
            no: (prev?.no ?? 0) + 1,
            total: typeof total === "number" && total > 0 ? total : (prev?.total ?? 0),
          }));
        }
        setSelectedChoice(null);
        setSelectedMulti([]);
        setAnswerText("");
        setDraftMode(false);
        setIsReview(!!r.context?.is_review);
        // 兜底：凡是服务端下发了待答题，它就一定是可作答的。
        // 同一道题被重新下发时（变式题用尽题库会回到原题），它可能还留在
        // closedQids 里 —— 那会让 closed 恒 true，提交按钮永远灰着（用户报障形态）。
        if (newQ.id) setClosedQids((prev) => (prev.has(newQ.id) ? removeFrom(prev, newQ.id) : prev));
      }

      // 终结判定（7.4）：只终结"上一题"，绝不连新题一起锁。
      // 旧规则 setClosed(isDone || pushed || !newQ) 用单个全局开关，
      // 换题时 pushed=true 会把刚下发的新题也标成已终结 → 作答区消失，
      // 用户表现为「答对一道题后新题无法作答，只能刷新或重进」。
      //
      // 注意 sameQ 的情况：服务端可能把同一道题再次下发（变式题用完题库兜底
      // 会回到原题，见 _pick_verify）。此时 prev 里的 question.id 就是新题 id，
      // 把它记进 closedQids 等于"下发即锁死"，closed 恒 true → 提交按钮永远灰着。
      // 所以换题时必须把新题 id 从集合里剔除，保证它一定可作答。
      if (isDone) {
        setSessionOver(true);
        if (question?.id) setClosedQids((prev) => new Set(prev).add(question.id));
      } else if (pushed && question?.id) {
        const prevQid = question.id;
        const nextQid = newQ?.id;
        setClosedQids((prev) => {
          const n = new Set(prev);
          n.add(prevQid);
          // 同一道题被重新下发 → 从已终结集合里移除，否则新题一出现就是只读
          if (nextQid) n.delete(nextQid);
          return n;
        });
        setSessionOver(false);
      } else if (!newQ) {
        setSessionOver(true);
      }
      // A9：本题终结时才解锁答案（替代原"自动翻面看答案"）
      // 裁决（7.8-2）：题已终结 → 显示标准答案；未终结 → 答案闸门锁着，DOM 里不出现答案。
      // 注意：后端 `_question_to_dict` 刻意不下发 answer（防泄题），所以标准答案只能来自
      // 判题响应的 correct_answer —— 答错时才有；答对时闸门显示"已答对"而非答案。
      //
      // 解锁的必须是「刚刚作答的那道题」（qid = question.id），不是刚下发的新题：
      // 判词属于旧题。若把 unlocked 挂到新题上，学生看到新题却写着"已答对"，
      // 会以为新题已经答过了（用户截图里就是这个形态）。
      // pushed 且换了新题 → 闸门回到锁定状态，等学生答新题。
      // A9：答案闸门。判据只有一条 —— **服务端是否下发了待答题**。
      // 下发了新题（换题或同题重发）→ 闸门锁上，unlocked 清空：学生眼前是新题，
      //   留着上一轮的"✓ 本题已答对"或旧题标准答案，只会让人以为这题已经答过
      //   （用户截图：题卡是新题，作答区却写着"已答对·已巩固"，按钮点不动）。
      // 没下发新题（isDone 或 newQ 为空）→ 本轮结束，闸门解锁展示结果。
      if (isDone || !newQ) {
        setGateOpen(true);
        setUnlocked({ answer: r.correct_answer ?? null, qid: question?.id ?? newQ?.id ?? "" });
      } else {
        setGateOpen(false);
        setUnlocked(null);
      }
    } catch (e: any) {
      setErr(e.message || "发送失败");
    } finally {
      setLoading(false);
    }
  }

  // 结构化快捷动作：hint 态"我看懂了，继续下一题 →"
  // A10：原名 goVerify（"去验证"），实际发的是"好，我试试"，行为保留、名字改准确
  const continueTurn = () => send("message", "好，我试试");

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

  // 提交辅助（按当前题题型校验并发送）—— A11：依据 question，且未终结、非草稿态才可提交
  const canSubmit =
    !!question &&
    !closed &&
    !draftMode &&
    (question.type === "choice"
      ? !!selectedChoice
      : question.type === "multi"
        ? selectedMulti.length > 0
        : !!answerText.trim());
  const submitAnswer = () => {
    if (!question || !canSubmit || loading) return;
    const ans =
      question.type === "choice"
        ? selectedChoice!
        : question.type === "multi"
          ? selectedMulti.join(",")
          : answerText;
    send(isTutor ? "message" : "answer", ans!);
  };

  // A12：退出会话与删除当前会话共用同一套重置（A13）
  function resetSession() {
    setSessionId(null);
    setActiveSessionId(null);
    setSessionType(null);
    setMsgs([]);
    setQuestion(null);
    setClosedQids(new Set());
    setSessionOver(false);
    setUnlocked(null);
    setGateOpen(false);
    setQIndex(null);
    setDraftMode(false);
    setIsReview(false);
    setDiagProgress({});
    setBulbOpen(false);
    setBulbHint(null);
    setSelectedChoice(null);
    setSelectedMulti([]);
    setAnswerText("");
    setErr(null);
  }

  function exitSession() {
    resetSession();
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
      // 若删除的是当前会话 → 退出（A13：复用 resetSession，不再抄一遍）
      if (deletingCurrent) {
        resetSession();
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
              <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
                <span className="font-medium" style={{ color: "var(--text)" }}>{typeLabel(sessionType)}会话</span>
                {/* 7.8-3：诊断会话不显示台阶刻度与答案闸门（诊断没有多轮引导语义） */}
                {isTutor ? (
                  <span className="flex items-center gap-2" aria-label="辅导进度">
                    {(["elicit", "identify", "hint", "verify"] as const).map((s, i) => (
                      <span key={s} className="flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          {/* 横刻度：竖线是"追问"的专属符号（05 §5.1），刻度不用竖线 */}
                          <span
                            className="inline-block h-0.5 w-4 rounded-full"
                            style={{ background: state === s ? "var(--accent)" : "var(--border)" }}
                          />
                          <span style={{ color: state === s ? "var(--accent)" : "var(--muted)" }}>
                            {{ elicit: "探明", identify: "识别", hint: "提示", verify: "变式" }[s]}
                          </span>
                        </span>
                        {i < 3 && <span className="sr-only">→</span>}
                      </span>
                    ))}
                  </span>
                ) : (
                  diagProgress.qcount && (
                    <span>
                      {diagProgress.answered ?? 0} / {diagProgress.qcount} 题
                    </span>
                  )
                )}
              </div>
              <div className="flex items-center gap-3">
                {isTutor && tutorProgress && (
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    新题 {tutorProgress.practice}/{tutorProgress.total}
                    {tutorProgress.review_left > 0 ? ` · 错题复习 ${tutorProgress.review_left}` : ""}
                  </span>
                )}
                <button className="text-xs" style={{ color: "var(--muted)" }} onClick={exitSession}>✕ 退出会话</button>
              </div>
            </div>

            {/* A 刀：左对话流 + 右题卡（题卡常驻参照，不进对话流、不吸顶） */}
            <div className="flex min-h-0 flex-1">
              {/* 左：对话流 */}
              <div className="flex min-w-0 flex-1 flex-col">
                {err && <p className="px-4 pt-3 text-xs text-red-500">{err}</p>}
                <div className="flex-1 overflow-auto px-4 py-4">
                  {msgs.length === 0 ? (
                    <p className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>
                      {finished ? "本轮结束 🎉" : "对话即将开始…"}
                    </p>
                  ) : (
                    <div className="mx-auto w-full max-w-xl space-y-3">
                      {msgs.map((m, i) =>
                        m.role === "me" ? (
                          <div key={i} className="flex flex-col items-end gap-1">
                            <div
                              className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm leading-relaxed"
                              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
                            >
                              <MathText text={m.text} />
                            </div>
                            {/* 判词：克制，只给状态，不作装饰（05 §4） */}
                            {m.verdict && (
                              <div
                                className="max-w-[85%] text-xs"
                                style={{ color: m.verdict.correct ? "var(--success)" : "#b3543c" }}
                              >
                                {m.verdict.correct ? "✓ 答对了" : "✗ 答错了"}
                                {m.verdict.feedback ? ` · ${m.verdict.feedback}` : ""}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div key={i} className="flex gap-2">
                            {/* 追问竖线：05 §5.1 规定竖线是"追问"的专属符号 */}
                            {m.probe && (
                              <span
                                className="w-0.5 shrink-0 self-stretch rounded-full"
                                style={{ background: "var(--accent)" }}
                                aria-hidden
                              />
                            )}
                            <div
                              className="max-w-[85%] text-sm leading-relaxed"
                              style={{ color: m.probe ? "var(--accent)" : "var(--text)", whiteSpace: "pre-wrap" }}
                            >
                              {m.text}
                            </div>
                          </div>
                        ),
                      )}
                      {loading && (
                        <div className="text-xs" style={{ color: "var(--muted)" }}>
                          思考中…
                        </div>
                      )}
                      <div ref={flowEndRef} />
                    </div>
                  )}
                </div>

                {/* 底部作答区（常驻）—— A11：依据 question，!draftMode && !closed 才可提交 */}
                <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
                  <div className="mx-auto w-full max-w-xl">
                    {finished ? (
                      <p className="py-2 text-center text-sm" style={{ color: "var(--muted)" }}>
                        {sessionType === "diagnostic" ? "诊断完成 🎉 可去报告页查看结果" : "本轮辅导完成 🎉"}
                      </p>
                    ) : (
                      <>
                        {/* hint 态的快捷推进（A10） */}
                        {isTutor && state === "hint" && (
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                              提示已放 💡 里，看看思路后继续。
                            </span>
                            <button
                              className="shrink-0 rounded px-3 py-1 text-sm text-white disabled:opacity-50"
                              style={{ background: "var(--accent)" }}
                              onClick={continueTurn}
                              disabled={loading}
                            >
                              继续下一题 →
                            </button>
                          </div>
                        )}

                        {/* 答案闸门（未解锁时锁着，答案不出现在 DOM —— V5） */}
                        <div
                          className="mb-2 rounded-lg border px-3 py-2 text-xs"
                          style={{ borderColor: gateOpen ? "var(--border)" : "var(--border)", background: "transparent" }}
                        >
                          {gateOpen && unlocked ? (
                            unlocked.answer ? (
                              <span style={{ color: "var(--muted)" }}>
                                答案闸门已解锁 · 标准答案：
                                <span style={{ color: "var(--text)" }}>
                                  <MathText text={unlocked.answer} />
                                </span>
                              </span>
                            ) : (
                              <span style={{ color: "var(--success)" }}>✓ 本题已答对 · 闸门已关闭（无需看答案）</span>
                            )
                          ) : (
                            <span style={{ color: "var(--muted)" }}>🔒 答案闸门锁着 —— 先自己把话说出来</span>
                          )}
                        </div>

                        {/* 作答组件随题型（05 §5.1） */}
                        {!draftMode && question && (
                          <div className="mb-2">
                            {question.type === "blank" && (
                              <input
                                className="w-full rounded border px-3 py-2 text-sm outline-none"
                                style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                                placeholder="输入你的答案…"
                                value={answerText}
                                onChange={(e) => setAnswerText(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && canSubmit && submitAnswer()}
                                disabled={loading}
                              />
                            )}
                            {question.type === "open" && (
                              <textarea
                                className="w-full rounded border px-3 py-2 text-sm outline-none"
                                style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)", minHeight: 72 }}
                                placeholder="写出你的思路和答案…"
                                value={answerText}
                                onChange={(e) => setAnswerText(e.target.value)}
                                disabled={loading}
                              />
                            )}
                            {(question.type === "choice" || question.type === "multi") && question.options && (
                              <div className="space-y-1.5">
                                {question.type === "multi" && (
                                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                                    （可多选，全部选对才算对）
                                  </p>
                                )}
                                {question.options.map((o, i) => {
                                  const letter = String.fromCharCode(65 + i);
                                  const clean = typeof o === "string" ? o.replace(/^[A-Z][\.．、]\s*/, "") : o;
                                  const active =
                                    question.type === "multi"
                                      ? selectedMulti.includes(letter)
                                      : selectedChoice === letter;
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
                                        question.type === "multi"
                                          ? setSelectedMulti((prev) =>
                                              prev.includes(letter) ? prev.filter((x) => x !== letter) : [...prev, letter],
                                            )
                                          : setSelectedChoice(letter)
                                      }
                                      disabled={loading}
                                    >
                                      <span
                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                                        style={{ background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--muted)" }}
                                      >
                                        {letter}
                                      </span>
                                      <MathText text={clean} />
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 草稿/作答双模式（原型 B 方案）—— V7 */}
                        <div className="flex items-center justify-between gap-2">
                          <button
                            className="rounded border px-3 py-1.5 text-xs disabled:opacity-40"
                            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                            onClick={() => setDraftMode((v) => !v)}
                            disabled={loading}
                          >
                            {draftMode ? "想清楚了，转成作答 ✎" : "先打草稿 ↩"}
                          </button>
                          <div className="flex items-center gap-2">
                            {isTutor && !draftMode && (
                              <button
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm transition-transform hover:scale-110 disabled:opacity-50"
                                style={{ borderColor: "var(--amber)", background: "var(--amber-soft)" }}
                                onClick={openBulb}
                                title="给我最接近的那一步"
                                disabled={bulbLoading || closed}
                              >
                                💡
                              </button>
                            )}
                            <button
                              className="rounded px-4 py-1.5 text-sm text-white disabled:opacity-50"
                              style={{ background: "var(--accent)" }}
                              onClick={submitAnswer}
                              disabled={loading || !canSubmit}
                            >
                              提交答案
                            </button>
                          </div>
                        </div>
                        {draftMode && (
                          <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                            草稿态：先把你的想法说一遍，不会被判分 —— 说给自己听。
                          </p>
                        )}
                        {/* 提交按钮在"未选答案/未填内容"时是灰的。用户会误以为卡死
                            （用户反馈："题目无法提交答案"其实是没选选项）。
                            明确说出还差什么，比让按钮默默灰着好。 */}
                        {!draftMode && question && !closed && !canSubmit && !loading && (
                          <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                            {question.type === "multi"
                              ? "勾选所有你认为正确的选项后即可提交（多选要不多不少才算全对）"
                              : question.type === "choice"
                                ? "先选一个选项，然后点「提交答案」"
                                : "写下你的答案后点「提交答案」"}
                          </p>
                        )}
                        {closed && !sessionOver && (
                          <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                            本题已结束，正在看下一题…
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* 右：当前题卡（常驻参照） */}
              {question && (
                <aside
                  className="hidden w-80 shrink-0 overflow-auto border-l p-4 lg:block"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="mb-2 flex items-center gap-2">
                    {qIndex && (
                      <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        第 {qIndex.no} / {qIndex.total} 题
                      </span>
                    )}
                    <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      {QTYPE_LABELS[question.type] || "题目"}
                    </span>
                    {isTutor && state === "verify" && (
                      <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        变式验证
                      </span>
                    )}
                    {isTutor && state === "identify" && (
                      <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--amber-soft)", color: "var(--text)" }}>
                        定位重试
                      </span>
                    )}
                    {isReview && (
                      <span className="rounded px-2 py-0.5 text-xs" style={{ background: "var(--amber-soft)", color: "#b3543c" }}>
                        复习
                      </span>
                    )}
                  </div>

                  <div className="text-[15px] leading-relaxed" style={{ color: "var(--text)" }}>
                    <MathText text={question.content} />
                  </div>

                  {(question.type === "choice" || question.type === "multi") && question.options && (
                    <div className="mt-3 space-y-1">
                      {question.options.map((o, i) => {
                        const clean = typeof o === "string" ? o.replace(/^[A-Z][\.．、]\s*/, "") : o;
                        return (
                          <div key={i} className="text-sm" style={{ color: "var(--muted)" }}>
                            {String.fromCharCode(65 + i)}. <MathText text={clean} />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 当前知识节点 + 掌握度（05 §4：强调色只用在当前节点） */}
                  <div className="mt-4 border-t pt-3 text-xs" style={{ borderColor: "var(--border)" }}>
                    <div style={{ color: "var(--muted)" }}>当前状态</div>
                    <div className="mt-0.5" style={{ color: "var(--accent)" }}>
                      {{ elicit: "探明 · 先说说你的思路", identify: "识别 · 定位卡点", hint: "提示 · 由浅入深", verify: "变式 · 换个数字再试", diagnose: "诊断中" }[state] ?? state}
                    </div>
                  </div>
                </aside>
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

// M6.1：useSearchParams 需 Suspense 边界（生产构建 prerender 强制要求）
export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}



