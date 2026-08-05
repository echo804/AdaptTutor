"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/** 欢迎页（M4r9）：淡黄素描纸 + 苏格拉底剪影 + 品牌名科技风格逐字打印 + 宣传语。
 * 已登录 → 直接进入 /chat；未登录 → 展示欢迎页 + 登录/注册 CTA。
 */

const BRAND = "AdaptTutor";
const TAGLINE = "AI 苏格拉底式自适应学习 — 智能诊断薄弱点，只给提示不给答案，在知识宇宙中点亮每一颗星";

/** 苏格拉底剪影：秃顶大胡子 + 长袍的哲学家半身像（墨色墨水感） */
function SocratesSilhouette() {
  return (
    <svg
      viewBox="0 0 120 150"
      className="socrates-silhouette h-32 w-auto sm:h-40"
      aria-hidden
    >
      {/* 长袍 */}
      <path
        d="M34 78 C34 60 48 50 60 50 C72 50 86 60 86 78 L94 138 C92 146 76 150 60 150 C44 150 28 146 26 138 Z"
        fill="#2c3e50"
      />
      {/* 长袍衣领褶皱 */}
      <path d="M48 52 C54 62 66 62 72 52" stroke="#f6ecdc" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* 头（秃顶圆头） */}
      <circle cx="60" cy="32" r="20" fill="#2c3e50" />
      {/* 大胡子（苏格拉底标志性浓密胡须，环绕下巴） */}
      <path
        d="M46 36 C42 52 46 62 52 68 C56 71 64 71 68 68 C74 62 78 52 74 36 C69 44 51 44 46 36 Z"
        fill="#2c3e50"
      />
      {/* 眉毛（沉思神情） */}
      <path d="M52 27 C55 25 58 25 61 27" stroke="#f6ecdc" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const [printed, setPrinted] = useState(0); // 已打印字符数
  const [showTag, setShowTag] = useState(false);
  const [showCta, setShowCta] = useState(false);

  // 已登录直接进应用（不等动画，避免闪烁）
  useEffect(() => {
    if (getToken()) router.replace("/chat");
  }, [router]);

  // 品牌名逐字打印 → 宣传语 → CTA
  useEffect(() => {
    if (printed < BRAND.length) {
      const t = setTimeout(() => setPrinted((p) => p + 1), 110);
      return () => clearTimeout(t);
    }
    if (!showTag) {
      const t = setTimeout(() => setShowTag(true), 350);
      return () => clearTimeout(t);
    }
    if (!showCta) {
      const t = setTimeout(() => setShowCta(true), 650);
      return () => clearTimeout(t);
    }
  }, [printed, showTag, showCta]);

  return (
    <div className="welcome-paper flex min-h-screen items-center justify-center">
      <main className="relative z-10 flex flex-col items-center px-6 text-center">
        {/* 苏格拉底剪影 */}
        <SocratesSilhouette />

        {/* 品牌名（逐字打印，墨蓝字 + 琥珀光标） */}
        <h1
          className="mt-5 font-mono text-5xl font-bold tracking-[0.12em] sm:text-6xl"
          style={{ color: "#2c3e50" }}
        >
          {BRAND.slice(0, printed)}
          <span className="type-cursor" style={{ display: printed >= BRAND.length ? "none" : "inline-block" }} />
        </h1>

        {/* 宣传语（打印完成后淡入） */}
        {showTag && (
          <p className="welcome-fade mt-4 max-w-xl text-sm leading-relaxed tracking-wide sm:text-base" style={{ color: "rgba(44,62,80,0.72)" }}>
            {TAGLINE}
          </p>
        )}

        {/* CTA（延迟淡入） */}
        {showCta && (
          <div className="welcome-fade mt-10 flex items-center gap-4">
            <Link
              href="/register"
              className="rounded-lg px-8 py-3 text-sm font-medium transition-transform hover:scale-105 hover:opacity-90"
              style={{ background: "var(--amber)", color: "#1a1a1a", boxShadow: "0 4px 20px rgba(212,165,116,0.45)" }}
            >
              开始学习
            </Link>
            <Link
              href="/login"
              className="rounded-lg border px-8 py-3 text-sm font-medium transition-colors hover:opacity-80"
              style={{ borderColor: "#2c3e50", color: "#2c3e50" }}
            >
              登录
            </Link>
          </div>
        )}

        {showCta && (
          <p className="welcome-fade mt-6 text-[11px] tracking-wider" style={{ color: "rgba(44,62,80,0.55)" }}>
            初中数学 · 大模型应用开发 · 更多领域持续加入
          </p>
        )}
      </main>
    </div>
  );
}
