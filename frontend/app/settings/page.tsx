"use client";

import { useCallback, useEffect, useState } from "react";
import { api, BailianModel, KeyItem, SettingsOut } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek（官方 API）" },
  { id: "bailian", label: "阿里云百炼（DashScope）", desc: "可运行百炼免费额度模型：通义千问系列 + DeepSeek V3/R1 等" },
  { id: "qwen", label: "通义千问（Qwen 官方）" },
  { id: "glm", label: "智谱 GLM" },
];

const MODEL_ROLES = [
  { key: "tutor", label: "核心推理模型（辅导讲解/诊断）" },
  { key: "generate", label: "出题模型（题目生成）" },
];

export default function SettingsPage() {
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [bailianModels, setBailianModels] = useState<BailianModel[]>([]);
  const [modelPrefs, setModelPrefs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 邀请码管理（M4r19）
  const [invites, setInvites] = useState<{ id: number; code: string; created_at: string; expires_at: string; used: boolean; expired: boolean }[]>([]);
  const [inviting, setInviting] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<number | null>(null);
  // 反馈管理（M4r22：管理员可见全部反馈）
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminFeedbacks, setAdminFeedbacks] = useState<{ id: number; user_id: number | null; content: string; category: string; status: string; created_at: string }[]>([]);

  useEffect(() => {
    Promise.all([
      api<KeyItem[]>("/me/api-keys"),
      api<BailianModel[]>("/me/api-keys/bailian/models"),
      api<SettingsOut>("/me/api-keys/settings").catch(() => ({ bailian_models: {} })),
    ])
      .then(([k, ms, s]) => {
        setKeys(k);
        setBailianModels(ms);
        setModelPrefs(s.bailian_models);
      })
      .catch((e) => setErr(e.message));
  }, []);

  const masked = (provider: string) =>
    keys.find((k) => k.provider === provider)?.masked_key;

  async function save(provider: string) {
    setErr(null);
    setMsg(null);
    try {
      const item = await api<KeyItem>(`/me/api-keys/${provider}`, {
        method: "PUT",
        body: { provider, api_key: inputs[provider] },
      });
      setKeys((prev) => {
        const rest = prev.filter((k) => k.provider !== provider);
        return [...rest, item];
      });
      setInputs((prev) => ({ ...prev, [provider]: "" }));
      setMsg(`已保存 ${provider} key`);
    } catch (e: any) {
      setErr(e.message || "保存失败");
    }
  }

  async function remove(provider: string) {
    setErr(null);
    setMsg(null);
    try {
      await api(`/me/api-keys/${provider}`, { method: "DELETE" });
      setKeys((prev) => prev.filter((k) => k.provider !== provider));
      setMsg(`已删除 ${provider} key`);
    } catch (e: any) {
      setErr(e.message || "删除失败");
    }
  }

  async function saveBailianPrefs() {
    setErr(null);
    setMsg(null);
    try {
      const r = await api<SettingsOut>("/me/api-keys/settings", {
        method: "PUT",
        body: { bailian_models: modelPrefs },
      });
      setModelPrefs(r.bailian_models);
      setMsg("已保存百炼模型偏好");
    } catch (e: any) {
      setErr(e.message || "保存失败");
    }
  }

  const hasBailianKey = keys.some((k) => k.provider === "bailian");

  // M4r19：邀请码管理
  const loadInvites = useCallback(async () => {
    try {
      const r = await api<{ items: typeof invites }>("/me/invite-codes");
      setInvites(r.items || []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  // M4r22：管理员加载全部反馈（非管理员静默）
  useEffect(() => {
    api<{ items: typeof adminFeedbacks }>("/admin/feedback")
      .then((r) => {
        setAdminFeedbacks(r.items || []);
        setIsAdmin(true);
      })
      .catch(() => setIsAdmin(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function updateFeedbackStatus(id: number, status: string) {
    try {
      await api(`/admin/feedback/${id}`, { method: "PATCH", body: { status } });
      setAdminFeedbacks((prev) => prev.map((f) => (f.id === id ? { ...f, status } : f)));
    } catch (e: any) {
      setErr(e.message || "更新失败");
    }
  }

  async function createInvite() {
    setErr(null); setMsg(null); setInviting(true);
    try {
      await api("/me/invite-codes", { method: "POST" });
      setMsg("邀请码已生成，复制发给朋友即可注册");
      await loadInvites();
    } catch (e: any) {
      setErr(e.message || "生成失败");
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: number) {
    setErr(null); setMsg(null);
    try {
      await api(`/me/invite-codes/${id}`, { method: "DELETE" });
      setMsg("已作废");
      await loadInvites();
    } catch (e: any) {
      setErr(e.message || "作废失败");
    }
  }

  async function copyInvite(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setMsg(`已复制邀请码：${code}`);
    } catch {
      setErr("复制失败，请手动复制");
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-semibold">设置</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
        LLM API key 仅加密存储在本服务，只显示掩码。未配置 key 时 AI 功能不可用。
      </p>

      {msg && <p className="mb-4 rounded px-3 py-2 text-sm text-green-700" style={{ background: "var(--accent-soft)" }}>{msg}</p>}
      {err && <p className="mb-4 rounded px-3 py-2 text-sm text-red-600" style={{ background: "var(--accent-soft)" }}>{err}</p>}

      <div className="space-y-4">
        {PROVIDERS.map((p) => (
          <div key={p.id} className="glass-card rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">{p.label}</span>
                {p.desc && (
                  <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{p.desc}</p>
                )}
              </div>
              {masked(p.id) ? (
                <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>
                  {masked(p.id)} <button className="ml-2 underline" onClick={() => remove(p.id)}>删除</button>
                </span>
              ) : (
                <span className="text-xs" style={{ color: "var(--muted)" }}>未配置</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder={`输入 ${p.label} API key`}
                className="flex-1 rounded border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                value={inputs[p.id] || ""}
                onChange={(e) => setInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
              />
              <button
                className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
                disabled={!(inputs[p.id] || "").trim()}
                onClick={() => save(p.id)}
              >
                保存
              </button>
            </div>

            {/* 百炼模型下拉（配了百炼 key 后显示） */}
            {p.id === "bailian" && hasBailianKey && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <div className="mb-2 text-sm font-medium">模型偏好（百炼免费额度）</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {MODEL_ROLES.map((role) => (
                    <label key={role.key} className="block text-xs" style={{ color: "var(--muted)" }}>
                      {role.label}
                      <select
                        className="mt-1 w-full rounded border px-2 py-1.5 text-sm outline-none"
                        style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                        value={modelPrefs[role.key] || ""}
                        onChange={(e) => setModelPrefs((prev) => ({ ...prev, [role.key]: e.target.value }))}
                      >
                        <option value="" disabled>选择模型</option>
                        {bailianModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <button
                  className="mt-3 rounded px-3 py-1.5 text-xs font-medium text-white"
                  style={{ background: "var(--accent)" }}
                  onClick={saveBailianPrefs}
                >
                  保存模型偏好
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 邀请码管理（M4r19：每位用户可邀请朋友/家人） */}
      <div className="mt-6 glass-card rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">邀请码</span>
          <button
            className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
            disabled={inviting}
            onClick={createInvite}
          >
            {inviting ? "生成中…" : "+ 生成邀请码"}
          </button>
        </div>
        <p className="mb-3 text-xs" style={{ color: "var(--muted)" }}>
          把邀请码发给朋友即可注册。每人最多同时持有 5 个未使用邀请码，有效期 7 天，一次性。
        </p>
        {invites.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>还没有邀请码，点右上角生成。</p>
        ) : (
          <ul className="space-y-2">
            {invites.map((it) => (
              <li key={it.id} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm" style={{ color: "var(--text)" }}>{it.code}</code>
                  <span className="rounded px-1.5 py-0.5 text-[10px]" style={{
                    background: it.used ? "#7ec8a022" : it.expired ? "var(--amber-soft)" : "var(--accent-soft)",
                    color: it.used ? "#7ec8a0" : it.expired ? "var(--amber)" : "var(--accent)",
                  }}>
                    {it.used ? "已使用" : it.expired ? "已作废" : "可用"}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                    至 {new Date(it.expires_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!it.used && !it.expired && (
                    <>
                      <button className="text-xs underline" style={{ color: "var(--accent)" }} onClick={() => copyInvite(it.code)}>
                        复制
                      </button>
                      <button className="text-xs" style={{ color: "var(--warn)" }} onClick={() => setPendingRevoke(it.id)}>
                        作废
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 反馈管理（M4r22：管理员处理用户反馈） */}
      {isAdmin && (
        <div className="mt-6 glass-card rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium">用户反馈管理</span>
            <span className="rounded px-2 py-0.5 text-[10px]" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
              {adminFeedbacks.filter((f) => f.status === "new").length} 条待处理
            </span>
          </div>
          {adminFeedbacks.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>暂无反馈。</p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-auto">
              {adminFeedbacks.map((f) => (
                <div key={f.id} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        {{ bug: "问题", suggestion: "建议", question: "疑问", other: "其他" }[f.category] || f.category}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                        #{f.id} · {new Date(f.created_at).toLocaleString()}
                      </span>
                    </div>
                    <select
                      className="rounded border px-1 py-0.5 text-[10px]"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                      value={f.status}
                      onChange={(e) => updateFeedbackStatus(f.id, e.target.value)}
                    >
                      <option value="new">待处理</option>
                      <option value="read">已读</option>
                      <option value="done">已解决</option>
                    </select>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text)" }}>{f.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 作废确认弹窗（M4r19：站内确认，替代原生 confirm） */}
      {pendingRevoke !== null && (
        <ConfirmDialog
          title="作废邀请码"
          message="确认作废这个邀请码？作废后不可恢复。"
          confirmText="作废"
          cancelText="取消"
          danger
          onConfirm={() => {
            const id = pendingRevoke;
            setPendingRevoke(null);
            revokeInvite(id);
          }}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </div>
  );
}
