"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken, AuthResponse } from "@/lib/api";

/** 登录页（M4r10）：复古笔记风，与欢迎页素描纸同系列（白纸 + 横线格 + 红边线 + 胶带） */
export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<AuthResponse>("/auth/login", {
        method: "POST",
        body: { username, password },
        token: null,
      });
      setToken(res.token);
      router.replace("/chat");
    } catch (err: any) {
      setError(err.message || "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="note-page relative flex min-h-screen items-center justify-center p-4">
      {/* 返回欢迎页 */}
      <Link
        href="/"
        className="absolute left-5 top-5 flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
        style={{ color: "rgba(44,62,80,0.55)" }}
      >
        <span aria-hidden>←</span> 返回欢迎页
      </Link>

      <form
        onSubmit={submit}
        className="note-card w-full max-w-sm px-12 py-10"
      >
        {/* 顶部胶带 */}
        <span className="note-tape" aria-hidden />

        <h1 className="note-title text-2xl">登录</h1>
        <p className="mt-1 mb-8 text-sm" style={{ color: "rgba(44,62,80,0.6)" }}>
          重新翻开思考的笔记
        </p>

        {error && (
          <p className="note-error mb-6">{error}</p>
        )}

        <label className="mb-6 block text-sm" style={{ color: "rgba(44,62,80,0.7)" }}>
          用户名
          <input
            className="note-input mt-1"
            style={{ background: "transparent" }}
            placeholder="写下你的名字"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>

        <label className="mb-8 block text-sm" style={{ color: "rgba(44,62,80,0.7)" }}>
          密码
          <input
            type="password"
            className="note-input mt-1"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button type="submit" disabled={loading} className="note-btn w-full">
          {loading ? "翻页中…" : "登录"}
        </button>

        <p className="mt-6 text-center text-sm" style={{ color: "rgba(44,62,80,0.55)" }}>
          还没有账号？{" "}
          <Link href="/register" className="underline decoration-dotted underline-offset-4" style={{ color: "#2c3e50" }}>
            邀请码注册
          </Link>
        </p>
      </form>
    </div>
  );
}
