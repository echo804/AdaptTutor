"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken, AuthResponse } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<AuthResponse>("/auth/register", {
        method: "POST",
        body: { username, password, invite_code: inviteCode },
        token: null,
      });
      setToken(res.token);
      router.replace("/settings"); // 注册后先去配置 key
    } catch (err: any) {
      setError(err.message || "注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border p-8 shadow-sm" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--accent)" }}>
          注册账号
        </h1>
        <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
          需要邀请码，注册后请先在设置页配置 API key
        </p>

        {error && (
          <p className="mb-4 rounded px-3 py-2 text-sm text-red-600" style={{ background: "var(--accent-soft)" }}>
            {error}
          </p>
        )}

        <label className="mb-2 block text-sm" style={{ color: "var(--muted)" }}>
          用户名
          <input
            className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>

        <label className="mb-2 block text-sm" style={{ color: "var(--muted)" }}>
          密码（至少 6 位）
          <input
            type="password"
            className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <label className="mb-6 block text-sm" style={{ color: "var(--muted)" }}>
          邀请码
          <input
            className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none"
            style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {loading ? "注册中…" : "注册"}
        </button>

        <p className="mt-4 text-center text-sm" style={{ color: "var(--muted)" }}>
          已有账号？{" "}
          <Link href="/login" className="underline" style={{ color: "var(--accent)" }}>
            去登录
          </Link>
        </p>
      </form>
    </div>
  );
}
