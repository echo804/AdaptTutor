"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/** 欢迎页（M4r9k）：淡黄素描纸 + 精细单线手绘苏格拉底完整人物线稿（无文字）+ 文字浮于其上。
 * 素材：用户从 AI 生成图中裁出的完整人物线稿（波浪卷发/长胡须/分层排线），透明背景。
 * 已登录 → 直接进入 /chat；未登录 → 展示欢迎页 + 登录/注册 CTA。
 */

const BRAND = "AdaptTutor";
const TITLE = "不是给予答案，而是唤醒思考";

export default function WelcomePage() {
  const router = useRouter();
  const [printed, setPrinted] = useState(0); // 已打印字符数
  const [showTitle, setShowTitle] = useState(false);   // 哲思标题
  const [showCta, setShowCta] = useState(false);       // 开启思辨之旅按钮
  const [showLogin, setShowLogin] = useState(false);   // 登录链接

  // 淡黄素描纸背景铺满整个页面（含 html/body，防止缩放/滚动露出米白底）
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.backgroundColor;
    const prevBody = body.style.backgroundColor;
    html.style.backgroundColor = "#f6ecdc";
    body.style.backgroundColor = "#f6ecdc";
    return () => {
      html.style.backgroundColor = prevHtml;
      body.style.backgroundColor = prevBody;
    };
  }, []);

  // 已登录直接进应用（不等动画，避免闪烁）
  useEffect(() => {
    if (getToken()) router.replace("/chat");
  }, [router]);

  // 品牌名逐字打印 → 标题 → 按钮 → 登录 → 底部小字（各段独立浮现，节奏从容）
  useEffect(() => {
    if (printed < BRAND.length) {
      const t = setTimeout(() => setPrinted((p) => p + 1), 110);
      return () => clearTimeout(t);
    }
    if (!showTitle) {
      const t = setTimeout(() => setShowTitle(true), 500);
      return () => clearTimeout(t);
    }
    if (!showCta) {
      const t = setTimeout(() => setShowCta(true), 750);
      return () => clearTimeout(t);
    }
    if (!showLogin) {
      const t = setTimeout(() => setShowLogin(true), 650);
      return () => clearTimeout(t);
    }
  }, [printed, showTitle, showCta, showLogin]);

  return (
    <div className="welcome-paper relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* 精细线稿水印（z-0，透明 PNG/WebP） */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/socrates-full.webp"
        alt=""
        aria-hidden
        className="pointer-events-none absolute z-0 h-[92vh] w-auto max-w-none select-none"
        draggable={false}
      />

      {/* 文字浮于线稿上（z-10） */}
      <main className="relative z-10 flex flex-col items-center px-6 py-16 text-center">
        <h1
          className="font-mono text-4xl font-bold tracking-[0.14em] sm:text-5xl"
          style={{ color: "#2c3e50" }}
        >
          {BRAND.slice(0, printed)}
          <span className="type-cursor" style={{ display: printed >= BRAND.length ? "none" : "inline-block" }} />
        </h1>

        {showTitle && (
          <h2
            className="welcome-fade mt-6 text-xl font-light leading-relaxed tracking-wide sm:text-2xl"
            style={{ color: "rgba(44,62,80,0.85)" }}
          >
            {TITLE}
          </h2>
        )}

        {showCta && (
          <div className="welcome-rise mt-10">
            <Link
              href="/register"
              className="inline-block rounded-full px-10 py-3.5 text-sm font-medium transition-transform hover:scale-105 hover:opacity-90"
              style={{ background: "var(--amber)", color: "#1a1a1a", boxShadow: "0 4px 20px rgba(212,165,116,0.45)" }}
            >
              开启思辨之旅
            </Link>
          </div>
        )}

        {showLogin && (
          <Link
            href="/login"
            className="welcome-soft mt-5 text-sm transition-opacity hover:opacity-70"
            style={{ color: "rgba(44,62,80,0.6)" }}
          >
            已有账号？登录
          </Link>
        )}
      </main>
    </div>
  );
}
