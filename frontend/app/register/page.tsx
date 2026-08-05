"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken, AuthResponse } from "@/lib/api";
import { QuillInk, PaperClip, Pencil, Magnifier, InkDots } from "@/components/NoteDecor";

/** 注册页（M4r10）：复古笔记风，与欢迎页素描纸同系列 */
export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [needsInvite, setNeedsInvite] = useState(true); // 首用户免邀请码
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ needs_invite: boolean }>("/auth/bootstrap", { token: null })
      .then((b) => setNeedsInvite(b.needs_invite))
      .catch(() => setNeedsInvite(true));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<AuthResponse>("/auth/register", {
        method: "POST",
        body: {
          username,
          password,
          invite_code: needsInvite ? inviteCode : null,
        },
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
    <div className="note-page relative flex min-h-screen items-center justify-center p-4">
      {/* 背景文具装饰（与登录页镜像分布，避免雷同） */}
      <PaperClip className="pointer-events-none absolute left-[8%] top-[13%] hidden w-16 -rotate-12 sm:block" />
      <QuillInk className="pointer-events-none absolute right-[5%] top-[11%] hidden w-28 rotate-6 sm:block lg:w-32" />
      <Magnifier className="pointer-events-none absolute bottom-[13%] left-[7%] hidden w-24 rotate-[10deg] sm:block lg:w-28" />
      <Pencil className="pointer-events-none absolute bottom-[10%] right-[8%] hidden w-24 -rotate-[14deg] sm:block lg:w-28" />
      <InkDots className="pointer-events-none absolute right-[5%] top-[45%] hidden w-40 opacity-70 sm:block" />
      <InkDots className="pointer-events-none absolute bottom-[6%] left-[3%] hidden w-48 -scale-x-100 opacity-60 sm:block" />

      {/* 返回欢迎页 */}
      <Link
        href="/"
        className="absolute left-5 top-5 flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
        style={{ color: "rgba(44,62,80,0.55)" }}
      >
        <span aria-hidden>←</span> 返回欢迎页
      </Link>

      <form onSubmit={submit} className="note-card w-full max-w-sm px-12 py-10">
        {/* 顶部胶带 */}
        <span className="note-tape" aria-hidden />

        <h1 className="note-title text-2xl">注册</h1>
        <p className="mt-1 mb-8 text-sm leading-relaxed" style={{ color: "rgba(44,62,80,0.6)" }}>
          {needsInvite
            ? "需要邀请码。注册后请先在设置页配置 API key"
            : "你是第一个用户（创建者），无需邀请码；注册后请先在设置页配置 API key"}
        </p>

        {error && (
          <p className="note-error mb-6">{error}</p>
        )}

        <label className="mb-6 block text-sm" style={{ color: "rgba(44,62,80,0.7)" }}>
          用户名
          <input
            className="note-input mt-1"
            placeholder="写下你的名字"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>

        <label className="mb-6 block text-sm" style={{ color: "rgba(44,62,80,0.7)" }}>
          密码（至少 6 位）
          <input
            type="password"
            className="note-input mt-1"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {needsInvite && (
          <label className="mb-8 block text-sm" style={{ color: "rgba(44,62,80,0.7)" }}>
            邀请码
            <input
              className="note-input mt-1"
              placeholder="输入邀请码"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
            />
          </label>
        )}

        <button type="submit" disabled={loading} className="note-btn w-full">
          {loading ? "翻页中…" : "注册"}
        </button>

        <p className="mt-6 text-center text-sm" style={{ color: "rgba(44,62,80,0.55)" }}>
          已有账号？{" "}
          <Link href="/login" className="underline decoration-dotted underline-offset-4" style={{ color: "#2c3e50" }}>
            去登录
          </Link>
        </p>
      </form>
    </div>
  );
}
