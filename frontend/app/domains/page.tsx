"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/** 我的领域（M4r8d）：用户自助导入素材 → AI 生成 → 发布/审核。
 * 含管理员审核队列（is_admin 用户可见）。
 */

interface MyDomain {
  id: number;
  pack_id: string;
  name: string;
  description: string | null;
  visibility: "private" | "public";
  status: string;
  reject_reason: string | null;
  nodes_count: number | null;
  questions_count: number | null;
  task: { status: string; progress: number; stage: string | null; error: string | null } | null;
}

interface AdminDomain {
  id: number;
  name: string;
  description: string | null;
  username: string;
  nodes_count: number | null;
  questions_count: number | null;
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  draft: { text: "生成中", color: "#d4a574" },
  published: { text: "已发布", color: "#7ec8a0" },
  pending_review: { text: "待审核", color: "#d4a574" },
  rejected: { text: "已驳回", color: "#b3543c" },
  takedown: { text: "已下架", color: "#b3543c" },
};

export default function DomainsPage() {
  const [items, setItems] = useState<MyDomain[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // 创建表单
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [mdFiles, setMdFiles] = useState<File[]>([]);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);

  // 审阅清单
  const [checklist, setChecklist] = useState<string | null>(null);

  // 管理员审核
  const [adminItems, setAdminItems] = useState<AdminDomain[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const pollingRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: MyDomain[] }>("/api/v1/user-domains");
      setItems(r.items || []);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    // 管理员审核队列（403 = 非管理员静默）
    api<{ items: AdminDomain[] }>("/api/v1/admin/domains?status=pending_review")
      .then((r) => {
        setAdminItems(r.items || []);
        setIsAdmin(true);
      })
      .catch(() => setIsAdmin(false));
  }, [load]);

  // 轮询生成中任务
  useEffect(() => {
    const hasRunning = items.some((i) => i.task?.status === "running" || i.status === "draft");
    if (hasRunning && pollingRef.current === null) {
      pollingRef.current = window.setInterval(() => load(), 3000);
    } else if (!hasRunning && pollingRef.current !== null) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [items, load]);

  async function create() {
    setErr(null);
    setMsg(null);
    if (!name.trim()) {
      setErr("请填写领域名称");
      return;
    }
    if (mdFiles.length === 0 && !zipFile && !text.trim()) {
      setErr("请上传 .md 文件、zip 包或粘贴文本作为素材");
      return;
    }
    setCreating(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("description", description.trim());
      fd.append("visibility", visibility);
      mdFiles.forEach((f) => fd.append("files", f));
      if (zipFile) fd.append("zip_file", zipFile);
      if (text.trim()) fd.append("text", text.trim());
      const r = await api<{ domain_id: number }>("/api/v1/user-domains", { method: "POST", body: fd });
      setMsg(`领域「${name.trim()}」已创建，AI 正在生成（约几分钟）…`);
      setShowCreate(false);
      setName("");
      setDescription("");
      setText("");
      setMdFiles([]);
      setZipFile(null);
      await load();
    } catch (e: any) {
      setErr(e.message || "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function publish(id: number, vis: string) {
    setErr(null);
    if (vis === "public" && !window.confirm("公开领域需管理员审核通过后其他用户才能看到，确认提交审核？")) return;
    try {
      const r = await api<{ status: string }>(`/api/v1/user-domains/${id}/publish`, { method: "POST" });
      setMsg(r.status === "published" ? "已发布 ✓" : "已提交审核，等待管理员通过");
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function remove(id: number, name0: string) {
    if (!window.confirm(`确认删除领域「${name0}」？删除后不可恢复。`)) return;
    try {
      await api<{ removed: number }>(`/api/v1/user-domains/${id}`, { method: "DELETE" });
      setMsg("已删除");
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function viewChecklist(id: number) {
    try {
      const r = await api<{ checklist: string }>(`/api/v1/user-domains/${id}/checklist`);
      setChecklist(r.checklist);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function review(did: number, approve: boolean) {
    try {
      const fd = new FormData();
      fd.append("approve", String(approve));
      if (!approve) fd.append("reason", window.prompt("驳回原因：") || "未通过审核");
      await api<{ status: string }>(`/api/v1/admin/domains/${did}/review`, { method: "POST", body: fd });
      setAdminItems((prev) => prev.filter((d) => d.id !== did));
      setMsg(approve ? "已通过审核" : "已驳回");
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
            我的领域
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            上传素材（.md / zip / 文本）→ AI 自动生成知识图谱与题目 → 发布即可学习
          </p>
        </div>
        <button
          className="rounded px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: "var(--accent)", color: "#fff" }}
          onClick={() => setShowCreate((v) => !v)}
        >
          + 创建领域
        </button>
      </div>

      {msg && <div className="mb-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--success)", color: "var(--success)" }}>{msg}</div>}
      {err && <div className="mb-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>{err}</div>}

      {/* 创建向导 */}
      {showCreate && (
        <div className="mb-5 rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text)" }}>新建领域</h2>
          <div className="mb-3 grid gap-3">
            <input
              placeholder="领域名称（如：Python 基础）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            <textarea
              placeholder="领域描述（可选）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "private" | "public")}
              className="w-full rounded border px-3 py-2 text-sm"
              style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            >
              <option value="private">仅自己可见（私有）</option>
              <option value="public">公开共享（需管理员审核）</option>
            </select>
          </div>
          <div className="mb-3 grid gap-3 text-sm">
            <label className="block">
              <span style={{ color: "var(--muted)" }}>上传 .md / .txt 素材（可多选，建议每篇 ≥ 200 字）</span>
              <input
                type="file"
                multiple
                accept=".md,.markdown,.txt"
                onChange={(e) => setMdFiles([...(e.target.files || [])])}
                className="mt-1 block w-full text-sm"
              />
            </label>
            <label className="block">
              <span style={{ color: "var(--muted)" }}>或上传 zip 包（内部目录 = 主题分组）</span>
              <input type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />
            </label>
            <label className="block">
              <span style={{ color: "var(--muted)" }}>或直接粘贴文本</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder="把知识内容粘贴到这里…"
                className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
                style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded px-4 py-2 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: "var(--accent)", color: "#fff" }}
              onClick={create}
              disabled={creating}
            >
              {creating ? "提交中…" : "开始 AI 生成"}
            </button>
            <button className="rounded px-4 py-2 text-sm" style={{ color: "var(--muted)" }} onClick={() => setShowCreate(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 我的领域列表 */}
      <div className="space-y-3">
        {items.length === 0 && !showCreate && (
          <div className="rounded-xl border p-8 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            还没有自建领域，点击右上角「+ 创建领域」导入你的知识素材 ✨
          </div>
        )}
        {items.map((d) => {
          const st = STATUS_LABEL[d.status] || { text: d.status, color: "var(--muted)" };
          const running = d.task?.status === "running" || d.status === "draft";
          return (
            <div key={d.id} className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{d.name}</span>
                    <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: st.color + "22", color: st.color }}>
                      {st.text}
                    </span>
                    <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      {d.visibility === "public" ? "公开" : "私有"}
                    </span>
                  </div>
                  {d.description && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{d.description}</p>}
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {d.nodes_count !== null ? `${d.nodes_count} 知识点 · ${d.questions_count} 题` : "生成中"}
                    {d.reject_reason && ` · 驳回原因：${d.reject_reason}`}
                  </p>
                  {running && d.task && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 w-40 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${d.task.progress}%`, background: "var(--amber)" }} />
                      </div>
                      <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                        {d.task.progress}% {d.task.stage || ""}
                      </span>
                    </div>
                  )}
                  {d.task?.status === "failed" && (
                    <p className="mt-1 text-xs" style={{ color: "var(--warn)" }}>生成失败：{d.task.error}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {d.status === "draft" && d.task?.status === "done" && (
                    <button className="rounded px-3 py-1 text-xs" style={{ background: "var(--accent)", color: "#fff" }} onClick={() => publish(d.id, d.visibility)}>
                      发布
                    </button>
                  )}
                  {d.status === "rejected" && (
                    <button className="rounded px-3 py-1 text-xs" style={{ background: "var(--accent)", color: "#fff" }} onClick={() => publish(d.id, d.visibility)}>
                      重新提交
                    </button>
                  )}
                  <button className="rounded px-3 py-1 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} onClick={() => viewChecklist(d.id)}>
                    审阅清单
                  </button>
                  <button className="rounded px-3 py-1 text-xs" style={{ color: "var(--warn)" }} onClick={() => remove(d.id, d.name)}>
                    删除
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 管理员审核队列 */}
      {isAdmin && adminItems.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-medium" style={{ color: "var(--text)" }}>审核队列（公开领域待审核）</h2>
          <div className="space-y-3">
            {adminItems.map((d) => (
              <div key={d.id} className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{d.name}</span>
                    <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>by {d.username}</span>
                    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                      {d.nodes_count ?? "?"} 知识点 · {d.questions_count ?? "?"} 题{d.description ? ` · ${d.description}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded px-3 py-1 text-xs" style={{ background: "var(--success)", color: "#fff" }} onClick={() => review(d.id, true)}>
                      通过
                    </button>
                    <button className="rounded px-3 py-1 text-xs" style={{ background: "var(--warn)", color: "#fff" }} onClick={() => review(d.id, false)}>
                      拒绝
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 审阅清单弹层 */}
      {checklist !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setChecklist(null)}>
          <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>审阅清单（AI 生成内容请人工核对）</span>
              <button className="text-sm" style={{ color: "var(--muted)" }} onClick={() => setChecklist(null)}>关闭</button>
            </div>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--text)" }}>{checklist}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
