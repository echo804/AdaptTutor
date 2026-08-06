"use client";

/** M6 可视化领域编辑器：图谱（React Flow 节点/边）+ 题目录入 + 校验/保存。
 * 布局：顶部工具栏 / 左侧图谱画布 / 右侧题目或节点属性面板。
 * 只读包（editable=false）全部禁用；节点位置存 localStorage（不进 schema）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  api,
  getDomainPack,
  validateDomainPack,
  saveDomainPack,
  type DomainPackOut,
  type PackQuestion,
} from "@/lib/api";
import { useThemeVar } from "@/lib/theme";

type PackNodeData = { name: string; difficulty: number; importance: number };

const POS_KEY = (pid: string) => `editor_pos_${pid}`;
const TYPE_LABEL: Record<string, string> = {
  choice: "选择",
  multi: "多选",
  blank: "填空",
  open: "解答",
};

/** 图谱节点组件：名称 + 难度徽标（墨蓝/琥珀语义）。 */
function PackNode({ data }: NodeProps) {
  const d = data as unknown as PackNodeData;
  const dot: CSSProperties = {
    width: 12,
    height: 12,
    borderRadius: "50%",
    border: "2px solid var(--surface)",
    background: "var(--amber)",
    cursor: "crosshair",
  };
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-sm"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <Handle type="target" position={Position.Top} style={{ ...dot, background: "var(--accent)" }} title="拖到这里连接" />
      <div style={{ color: "var(--text)", fontWeight: 600, whiteSpace: "nowrap" }}>
        {d.name}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span
          className="rounded px-1 py-0.5 text-[10px]"
          style={{
            background: "var(--amber-soft)",
            color: "var(--amber)",
          }}
        >
          难度 {Math.round((d.difficulty ?? 0.5) * 100)}
        </span>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          权重 {Math.round((d.importance ?? 0.5) * 100)}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} style={dot} title="从这里拖出连线" />
    </div>
  );
}

const nodeTypes = { pack: PackNode };

export default function EditorPage() {
  const { packId } = useParams<{ packId: string }>();
  const router = useRouter();
  const accent = useThemeVar("--accent", "#2c3e50");
  const amber = useThemeVar("--amber", "#d4a574");

  const [pack, setPack] = useState<DomainPackOut | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selNodeId, setSelNodeId] = useState<string | null>(null);
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null);
  const [selQid, setSelQid] = useState<string | null>(null);

  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || !packId) return;
    loaded.current = true;
    getDomainPack(packId)
      .then((p) => {
        setPack(p);
        // 恢复节点位置（localStorage）或默认网格
        const saved = localStorage.getItem(POS_KEY(packId));
        let posMap: Record<string, { x: number; y: number }> = {};
        try {
          posMap = saved ? JSON.parse(saved) : {};
        } catch {
          /* ignore */
        }
        setNodes(
          p.graph.nodes.map((n, i) => ({
            id: n.id,
            type: "pack",
            position: posMap[n.id] ?? { x: (i % 4) * 190, y: Math.floor(i / 4) * 130 },
            data: { name: n.name, difficulty: n.difficulty, importance: n.importance },
          })),
        );
        setEdges(
          p.graph.edges.map((e) => ({
            id: `${e.from}->${e.to}`,
            source: e.from,
            target: e.to,
            type: "smoothstep",
            style: { stroke: "var(--border)" },
          })),
        );
      })
      .catch((e) => setError(String((e as Error)?.message ?? e)));
  }, [packId]);

  const editable = pack?.editable ?? false;

  const persistPos = (next: Node[]) => {
    if (!packId) return;
    const posMap: Record<string, { x: number; y: number }> = {};
    for (const n of next) posMap[n.id] = n.position;
    localStorage.setItem(POS_KEY(packId), JSON.stringify(posMap));
  };

  const onNodesChange = (changes: any[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      persistPos(next);
      return next;
    });
  };

  const onConnect = (conn: Connection) => {
    if (!editable) return;
    if (conn.source === conn.target) return;
    setEdges((eds) => {
      if (eds.some((e) => e.source === conn.source && e.target === conn.target)) return eds;
      return addEdge({ ...conn, type: "smoothstep", style: { stroke: "var(--border)" } }, eds);
    });
  };

  /** 点击边选中（高亮）；再次点击空白取消。 */
  const onEdgeClick = (_: unknown, edge: Edge) => {
    setSelNodeId(null);
    setSelEdgeId(edge.id);
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        style: e.id === edge.id ? { stroke: accent, strokeWidth: 2 } : { stroke: "var(--border)" },
      })),
    );
  };

  /** 删除选中的边（连线撤回）。 */
  const deleteEdge = () => {
    if (!editable || !selEdgeId) return;
    setEdges((eds) => eds.filter((e) => e.id !== selEdgeId));
    setSelEdgeId(null);
  };

  const clearSelection = () => {
    setSelNodeId(null);
    setSelEdgeId(null);
  };

  const addNode = () => {
    if (!editable || !pack) return;
    const used = new Set(pack.graph.nodes.map((n) => n.id));
    let i = 1;
    while (used.has(`n${String(i).padStart(2, "0")}`)) i++;
    const id = `n${String(i).padStart(2, "0")}`;
    setPack({
      ...pack,
      graph: {
        ...pack.graph,
        nodes: [...pack.graph.nodes, { id, name: "新知识点", difficulty: 0.5, importance: 0.5 }],
      },
    });
    setNodes((nds) => [
      ...nds,
      { id, type: "pack", position: { x: 80 + nds.length * 30, y: 80 + nds.length * 30 }, data: { name: "新知识点", difficulty: 0.5, importance: 0.5 } },
    ]);
    setSelNodeId(id);
  };

  const deleteSelected = () => {
    if (!editable || !selNodeId || !pack) return;
    const id = selNodeId;
    setPack({
      ...pack,
      graph: {
        nodes: pack.graph.nodes.filter((n) => n.id !== id),
        edges: pack.graph.edges.filter((e) => e.from !== id && e.to !== id),
      },
      questions: pack.questions.map((q) => ({
        ...q,
        step_node_map: Object.fromEntries(
          Object.entries(q.step_node_map || {}).filter(([, v]) => v !== id),
        ),
      })),
    });
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    if (selQid && pack.questions.find((q) => q.id === selQid)?.step_node_map) setSelQid(selQid);
    setSelNodeId(null);
  };

  /** 从画布状态构建待校验/保存的完整包（nodes/edges 同步画布上的最新改动）。 */
  const buildBody = (): Record<string, unknown> | null => {
    if (!pack) return null;
    const byId = new Map(nodes.map((n) => [n.id, n.data]));
    const graphNodes = pack.graph.nodes.map((n) => ({
      ...n,
      name: byId.get(n.id)?.name ?? n.name,
      difficulty: byId.get(n.id)?.difficulty ?? n.difficulty,
      importance: byId.get(n.id)?.importance ?? n.importance,
    }));
    return {
      manifest: pack.manifest,
      graph: {
        nodes: graphNodes,
        edges: edges.map((e) => ({ from: e.source, to: e.target, type: "prerequisite" as const })),
      },
      questions: pack.questions,
      diagnostic_rules: pack.diagnostic_rules,
      assessment: pack.assessment,
    };
  };

  const save = async () => {
    if (!pack || !packId || !editable) return;
    setSaving(true);
    setNotice("");
    setErrors([]);
    try {
      const body = buildBody();
      if (!body) return;
      const v = await validateDomainPack(body);
      if (!v.valid) {
        setErrors(v.errors);
        setNotice("");
        return;
      }
      await saveDomainPack(packId, body);
      setNotice("已保存 ✓ 图谱与题目已写入领域包");
    } catch (e) {
      setErrors([String((e as Error)?.message ?? e)]);
    } finally {
      setSaving(false);
    }
  };

  const runValidate = async () => {
    if (!pack) return;
    setValidating(true);
    setErrors([]);
    try {
      const body = buildBody();
      if (!body) return;
      const v = await validateDomainPack(body);
      setErrors(v.errors);
      if (v.valid) setNotice("校验通过 ✓");
    } catch (e) {
      setErrors([String((e as Error)?.message ?? e)]);
    } finally {
      setValidating(false);
    }
  };

  // 面板数据
  const selNode = useMemo(
    () => (selNodeId ? pack?.graph.nodes.find((n) => n.id === selNodeId) : null),
    [selNodeId, pack],
  );
  const selQ = useMemo(
    () => (selQid ? pack?.questions.find((q) => q.id === selQid) : null),
    [selQid, pack],
  );

  if (error)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl border p-6 text-sm" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          加载失败：{error}
          <div className="mt-3">
            <Link href="/domains" className="underline">← 返回我的领域</Link>
          </div>
        </div>
      </div>
    );

  if (!pack)
    return (
      <div className="flex min-h-screen items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
        加载中…
      </div>
    );

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--bg)" }}>
      {/* 顶部工具栏 */}
      <div
        className="flex items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <Link href="/domains" className="text-sm" style={{ color: "var(--muted)" }}>← 返回</Link>
        <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>{pack.manifest.subject}</div>
        <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: editable ? "var(--amber-soft)" : "var(--accent-soft)", color: editable ? "var(--amber)" : "var(--muted)" }}>
          {editable ? "可编辑" : "只读"}
        </span>
        <div className="flex-1" />
        <button
          className="rounded border px-3 py-1 text-xs disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
          onClick={runValidate}
          disabled={validating || !editable}
        >
          {validating ? "校验中…" : "校验"}
        </button>
        <button
          className="rounded px-4 py-1 text-xs text-white disabled:opacity-50"
          style={{ background: accent }}
          onClick={save}
          disabled={saving || !editable}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      {notice && (
        <div className="px-4 py-1.5 text-xs" style={{ color: "var(--success)" }}>{notice}</div>
      )}
      {errors.length > 0 && (
        <div className="max-h-28 overflow-auto px-4 py-1.5 text-xs" style={{ color: "var(--warn)" }}>
          {errors.map((e, i) => <div key={i}>⚠ {e}</div>)}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：图谱画布 */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            onNodeClick={(_, n) => setSelNodeId(n.id)}
            onPaneClick={clearSelection}
            deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
            nodeTypes={nodeTypes}
            nodesDraggable={editable}
            nodesConnectable={editable}
            fitView
            proOptions={{ hideAttribution: true }}
            style={{ background: "var(--bg)" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} color="var(--border)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* 右侧：题目 / 节点面板 */}
        <div className="flex w-[380px] flex-col border-l" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
            {editable && (
              <button
                className="rounded border px-2 py-0.5 text-[11px]"
                style={{ borderColor: "var(--amber)", color: "var(--amber)" }}
                onClick={addNode}
              >
                + 节点
              </button>
            )}
            {selNode && editable && (
              <button
                className="rounded border px-2 py-0.5 text-[11px]"
                style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
                onClick={deleteSelected}
              >
                删除节点
              </button>
            )}
            {selEdgeId && editable && (
              <button
                className="rounded border px-2 py-0.5 text-[11px]"
                style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
                onClick={deleteEdge}
              >
                删除连线
              </button>
            )}
            <div className="flex-1" />
            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
              {selNode ? "节点属性" : selEdgeId ? `连线 ${selEdgeId}` : `题目 ${pack.questions.length}`}
            </span>
          </div>

          {editable && !selNode && !selEdgeId && (
            <div className="border-b px-3 py-1.5 text-[11px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              连线：从节点<span style={{ color: "var(--amber)" }}>底部圆点</span>拖到另一节点<span style={{ color: "var(--accent)" }}>顶部圆点</span>，方向 = 前置依赖
              · 撤回：<span style={{ color: "var(--warn)" }}>点击连线后按 Delete 或点「删除连线」</span>
            </div>
          )}

          <div className="flex-1 overflow-auto p-3">
            {selNode ? (
              <NodeForm
                node={selNode}
                editable={editable}
                onChange={(patch) =>
                  setPack({
                    ...pack,
                    graph: {
                      ...pack.graph,
                      nodes: pack.graph.nodes.map((n) =>
                        n.id === selNode.id ? { ...n, ...patch } : n,
                      ),
                    },
                  })
                }
              />
            ) : (
              <QuestionPanel
                questions={pack.questions}
                editable={editable}
                selQid={selQid}
                nodeIds={pack.graph.nodes.map((n) => n.id)}
                amber={amber}
                onSelect={setSelQid}
                onChange={(qs) => setPack({ ...pack, questions: qs })}
                onEdit={(q) => setSelQid(q.id)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- 节点属性表单 ----------

function NodeForm({
  node,
  editable,
  onChange,
}: {
  node: { id: string; name: string; difficulty: number; importance: number };
  editable: boolean;
  onChange: (patch: Partial<typeof node>) => void;
}) {
  const input = (v: string) =>
    ({ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 6 }) as CSSProperties;
  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>节点 id（不可改）</div>
        <div className="rounded px-2 py-1 text-xs" style={{ background: "var(--bg)", color: "var(--muted)" }}>{node.id}</div>
      </div>
      <div>
        <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>名称</div>
        <input
          className="w-full px-2 py-1 text-sm outline-none disabled:opacity-50"
          style={input("")}
          value={node.name}
          disabled={!editable}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div>
        <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>难度 {node.difficulty.toFixed(2)}</div>
        <input
          className="w-full"
          type="range" min={0} max={1} step={0.05}
          value={node.difficulty}
          disabled={!editable}
          onChange={(e) => onChange({ difficulty: Number(e.target.value) })}
        />
      </div>
      <div>
        <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>重要性（路径权重）{node.importance.toFixed(2)}</div>
        <input
          className="w-full"
          type="range" min={0} max={1} step={0.05}
          value={node.importance}
          disabled={!editable}
          onChange={(e) => onChange({ importance: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}

// ---------- 题目面板 ----------

function QuestionPanel({
  questions,
  editable,
  selQid,
  nodeIds,
  amber,
  onSelect,
  onChange,
  onEdit,
}: {
  questions: PackQuestion[];
  editable: boolean;
  selQid: string | null;
  nodeIds: string[];
  amber: string;
  onSelect: (id: string | null) => void;
  onChange: (qs: PackQuestion[]) => void;
  onEdit: (q: PackQuestion) => void;
}) {
  const sel = questions.find((q) => q.id === selQid) ?? null;
  const input = () =>
    ({ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 6 }) as CSSProperties;

  const addQ = () => {
    const used = new Set(questions.map((q) => q.id));
    let i = 1;
    while (used.has(`q${String(i).padStart(3, "0")}`)) i++;
    const q: PackQuestion = {
      id: `q${String(i).padStart(3, "0")}`,
      type: "choice",
      content: "新题目：题干……",
      tags: [],
      difficulty: 0.5,
      options: ["选项 A", "选项 B"],
      answer: "A",
      step_node_map: {},
    };
    onChange([...questions, q]);
    onEdit(q);
  };

  const patchQ = (patch: Partial<PackQuestion>) => {
    if (!sel) return;
    onChange(questions.map((q) => (q.id === sel.id ? { ...q, ...patch } : q)));
  };

  const delQ = () => {
    if (!sel) return;
    onChange(questions.filter((q) => q.id !== sel.id));
    onSelect(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {editable && (
          <button
            className="rounded border px-2 py-0.5 text-[11px]"
            style={{ borderColor: "var(--amber)", color: "var(--amber)" }}
            onClick={addQ}
          >
            + 题目
          </button>
        )}
        {sel && editable && (
          <button
            className="rounded border px-2 py-0.5 text-[11px]"
            style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
            onClick={delQ}
          >
            删除
          </button>
        )}
      </div>

      {/* 题目列表 */}
      <div className="max-h-40 space-y-1 overflow-auto">
        {questions.map((q) => (
          <button
            key={q.id}
            className="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs disabled:opacity-50"
            style={{
              borderColor: q.id === selQid ? amber : "var(--border)",
              background: q.id === selQid ? "var(--amber-soft)" : "transparent",
            }}
            onClick={() => onSelect(q.id)}
          >
            <span className="shrink-0 rounded px-1 py-0.5 text-[10px]" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              {TYPE_LABEL[q.type]}
            </span>
            <span className="truncate" style={{ color: "var(--text)" }}>{q.content}</span>
            <span className="ml-auto shrink-0 text-[10px]" style={{ color: "var(--muted)" }}>{Math.round(q.difficulty * 100)}</span>
          </button>
        ))}
      </div>

      {/* 题目编辑表单 */}
      {sel && (
        <div className="space-y-2.5 border-t pt-3 text-sm" style={{ borderColor: "var(--border)" }}>
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>id</div>
              <input className="w-full px-2 py-1 text-sm outline-none disabled:opacity-50" style={input()} value={sel.id} disabled={!editable}
                onChange={(e) => patchQ({ id: e.target.value })} />
            </div>
            <div className="w-24">
              <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>题型</div>
              <select className="w-full px-1 py-1 text-sm outline-none disabled:opacity-50" style={input()} value={sel.type} disabled={!editable}
                onChange={(e) => patchQ({ type: e.target.value as PackQuestion["type"] })}>
                <option value="choice">选择</option>
                <option value="multi">多选</option>
                <option value="blank">填空</option>
                <option value="open">解答</option>
              </select>
            </div>
            <div className="w-24">
              <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>难度</div>
              <input type="number" min={0} max={1} step={0.05} className="w-full px-1 py-1 text-sm outline-none disabled:opacity-50" style={input()} value={sel.difficulty} disabled={!editable}
                onChange={(e) => patchQ({ difficulty: Math.max(0, Math.min(1, Number(e.target.value))) })} />
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>题干（支持 $KaTeX$）</div>
            <textarea rows={3} className="w-full px-2 py-1 text-sm outline-none disabled:opacity-50" style={input()} value={sel.content} disabled={!editable}
              onChange={(e) => patchQ({ content: e.target.value })} />
          </div>

          <div>
            <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>标签（逗号分隔）</div>
            <input className="w-full px-2 py-1 text-sm outline-none disabled:opacity-50" style={input()} value={(sel.tags || []).join("，")} disabled={!editable}
              onChange={(e) => patchQ({ tags: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
          </div>

          {(sel.type === "choice" || sel.type === "multi") && (
            <OptionsEditor q={sel} editable={editable} onChange={patchQ} input={input} />
          )}

          {(sel.type === "blank" || sel.type === "open") && (
            <div>
              <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>标准答案</div>
              <input className="w-full px-2 py-1 text-sm outline-none disabled:opacity-50" style={input()} value={String(sel.answer ?? "")} disabled={!editable}
                onChange={(e) => patchQ({ answer: e.target.value })} />
            </div>
          )}

          <div>
            <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>步骤 → 知识点映射（错题溯源）</div>
            {Object.entries(sel.step_node_map || {}).map(([step, node]) => (
              <div key={step} className="mb-1 flex items-center gap-1.5">
                <input className="w-20 px-1 py-0.5 text-xs outline-none disabled:opacity-50" style={input()} value={step} disabled={!editable}
                  onChange={(e) => {
                    const m = { ...(sel.step_node_map || {}) };
                    delete m[step];
                    m[e.target.value] = node;
                    patchQ({ step_node_map: m });
                  }} />
                <span className="text-[10px]" style={{ color: "var(--muted)" }}>→</span>
                <select className="flex-1 px-1 py-0.5 text-xs outline-none disabled:opacity-50" style={input()} value={node} disabled={!editable}
                  onChange={(e) => patchQ({ step_node_map: { ...(sel.step_node_map || {}), [step]: e.target.value } })}>
                  <option value="">（未映射）</option>
                  {nodeIds.map((nid) => <option key={nid} value={nid}>{nid}</option>)}
                </select>
                {editable && (
                  <button className="text-[10px]" style={{ color: "var(--warn)" }}
                    onClick={() => {
                      const m = { ...(sel.step_node_map || {}) };
                      delete m[step];
                      patchQ({ step_node_map: m });
                    }}>✕</button>
                )}
              </div>
            ))}
            {editable && (
              <button className="mt-0.5 text-[11px]" style={{ color: "var(--amber)" }}
                onClick={() => {
                  const i = Object.keys(sel.step_node_map || {}).length + 1;
                  patchQ({ step_node_map: { ...(sel.step_node_map || {}), [`step${i}`]: nodeIds[0] ?? "" } });
                }}>
                + 步骤映射
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 选项编辑器（choice/multi） ----------

function OptionsEditor({
  q,
  editable,
  onChange,
  input,
}: {
  q: PackQuestion;
  editable: boolean;
  onChange: (patch: Partial<PackQuestion>) => void;
  input: () => CSSProperties;
}) {
  const opts = q.options ?? [];
  const letters = opts.map((_, i) => String.fromCharCode(65 + i));
  const setOpt = (i: number, v: string) => {
    const next = [...opts];
    next[i] = v;
    onChange({ options: next });
  };

  return (
    <div>
      <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>
        选项（{q.type === "multi" ? "多选，答案可勾多个" : "单选，答案选一个"}）
      </div>
      {opts.map((o, i) => (
        <div key={i} className="mb-1 flex items-center gap-1.5">
          <span className="w-4 text-xs font-semibold" style={{ color: "var(--accent)" }}>{letters[i]}</span>
          <input className="flex-1 px-1.5 py-0.5 text-xs outline-none disabled:opacity-50" style={input()} value={o} disabled={!editable}
            onChange={(e) => setOpt(i, e.target.value)} />
          {editable && (
            <button className="text-[10px]" style={{ color: "var(--warn)" }}
              onClick={() => {
                const next = opts.filter((_, j) => j !== i);
                onChange({ options: next.length ? next : null });
              }}>✕</button>
          )}
        </div>
      ))}
      {editable && (
        <button className="mt-0.5 text-[11px]" style={{ color: "var(--amber)" }}
          onClick={() => onChange({ options: [...opts, "新选项"] })}>
          + 选项
        </button>
      )}
      <div className="mt-2">
        <div className="mb-1 text-xs" style={{ color: "var(--muted)" }}>答案</div>
        {q.type === "choice" ? (
          <select className="w-full px-1 py-1 text-sm outline-none disabled:opacity-50" style={input()} value={String(q.answer ?? "")} disabled={!editable}
            onChange={(e) => onChange({ answer: e.target.value })}>
            {letters.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        ) : (
          <div className="flex flex-wrap gap-2">
            {letters.map((l) => {
              const ans = Array.isArray(q.answer) ? q.answer : [];
              const on = ans.includes(l);
              return (
                <label key={l} className="flex items-center gap-1 text-xs" style={{ color: "var(--text)" }}>
                  <input type="checkbox" checked={on} disabled={!editable}
                    onChange={(e) => {
                      const next = e.target.checked ? [...ans, l] : ans.filter((a) => a !== l);
                      onChange({ answer: next });
                    }} />
                  {l}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
