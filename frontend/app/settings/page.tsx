"use client";

import { useEffect, useState } from "react";
import { api, BailianModel, KeyItem, SettingsOut } from "@/lib/api";

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
          <div key={p.id} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
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
    </div>
  );
}
