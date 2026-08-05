"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, setToken, AuthResponse } from "@/lib/api";
import { QuillInk, Glasses, MapleLeaf, Feather, InkDots } from "@/components/NoteDecor";

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
      {/* 背景文具装饰（手绘淡墨线，复古文艺风，低透明） */}
      <QuillInk className="pointer-events-none absolute left-[6%] top-[12%] hidden w-28 -rotate-6 sm:block lg:w-32" />
      <Glasses className="pointer-events-none absolute right-[9%] top-[13%] hidden w-24 rotate-6 sm:block lg:w-28" />
      <MapleLeaf className="pointer-events-none absolute bottom-[13%] left-[8%] hidden w-20 -rotate-[18deg] sm:block lg:w-24" />
      <MapleLeaf className="pointer-events-none absolute bottom-[24%] left-[16%] hidden w-12 rotate-[24deg] opacity-60 sm:block lg:w-14" />
      <Feather className="pointer-events-none absolute bottom-[12%] right-[9%] hidden w-28 rotate-[10deg] sm:block lg:w-32" />
      <InkDots className="pointer-events-none absolute left-[4%] top-[45%] hidden w-40 opacity-70 sm:block" />
      <InkDots className="pointer-events-none absolute bottom-[6%] right-[3%] hidden w-48 -scale-x-100 opacity-60 sm:block" />

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
