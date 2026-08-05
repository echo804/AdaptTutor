"use client";

import { useEffect, useState } from "react";
import { api, KeyItem } from "@/lib/api";

const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "qwen", label: "通义千问（Qwen）" },
  { id: "glm", label: "智谱 GLM" },
];

export default function SettingsPage() {
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<KeyItem[]>("/me/api-keys").then(setKeys).catch((e) => setErr(e.message));
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
              <span className="text-sm font-medium">{p.label}</span>
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
          </div>
        ))}
      </div>
    </div>
  );
}
