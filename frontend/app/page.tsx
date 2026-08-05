"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/** 欢迎页（M4r9）：深邃动态粒子星空 + 品牌名科技风格逐字打印 + 宣传语。
 * 已登录 → 直接进入 /chat；未登录 → 展示欢迎页 + 登录/注册 CTA。
 */

const BRAND = "AdaptTutor";
const TAGLINE = "AI 苏格拉底式自适应学习 — 智能诊断薄弱点，只给提示不给答案，在知识宇宙中点亮每一颗星";

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
    <div className="welcome-starfield flex min-h-screen items-center justify-center">
      {/* 中央月牙光晕 */}
      <div className="welcome-glow" />
      <div className="welcome-glow" style={{ top: "46%", width: 460, height: 460, opacity: 0.5 }} />

      <main className="relative z-10 flex flex-col items-center px-6 text-center">
        {/* 月牙 + 品牌名（逐字打印） */}
        <div className="mb-6 flex items-center gap-5">
          <div className="welcome-crescent" aria-hidden />
          <h1
            className="font-mono text-5xl font-bold tracking-[0.12em] sm:text-6xl"
            style={{
              color: "var(--text)",
              textShadow: "0 0 24px rgba(212,165,116,0.35)",
            }}
          >
            {BRAND.slice(0, printed)}
            <span className="type-cursor" style={{ display: printed >= BRAND.length ? "none" : "inline-block" }} />
          </h1>
        </div>

        {/* 宣传语（打印完成后淡入） */}
        {showTag && (
          <p className="welcome-fade max-w-xl text-sm leading-relaxed tracking-wide sm:text-base" style={{ color: "var(--muted)" }}>
            {TAGLINE}
          </p>
        )}

        {/* CTA（延迟淡入） */}
        {showCta && (
          <div className="welcome-fade mt-10 flex items-center gap-4">
            <Link
              href="/register"
              className="rounded-lg px-8 py-3 text-sm font-medium transition-transform hover:scale-105 hover:opacity-90"
              style={{ background: "var(--amber)", color: "#1a1a1a", boxShadow: "0 4px 20px rgba(212,165,116,0.35)" }}
            >
              开始学习
            </Link>
            <Link
              href="/login"
              className="rounded-lg border px-8 py-3 text-sm font-medium transition-colors hover:opacity-80"
              style={{ borderColor: "var(--accent)", color: "var(--text)" }}
            >
              登录
            </Link>
          </div>
        )}

        {showCta && (
          <p className="welcome-fade mt-6 text-[11px] tracking-wider" style={{ color: "var(--muted)", opacity: 0.7 }}>
            初中数学 · 大模型应用开发 · 更多领域持续加入
          </p>
        )}
      </main>
    </div>
  );
}
