"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/** 欢迎页（M4r9c）：淡黄素描纸 + 左侧苏格拉底侧脸剪影（卷发/大胡子/长袍）+ 右侧品牌打印与 CTA。
 * 已登录 → 直接进入 /chat；未登录 → 展示欢迎页 + 登录/注册 CTA。
 */

const BRAND = "AdaptTutor";
const TAGLINE = "AI 苏格拉底式自适应学习 — 智能诊断薄弱点，只给提示不给答案，在知识宇宙中点亮每一颗星";

/** 苏格拉底侧脸剪影：卷发 + 大胡子 + 长袍（朝右的哲学家侧像，墨色墨水感） */
function SocratesSilhouette({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 360 520"
      className={`socrates-silhouette ${className}`}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      {/* 长袍（肩部 → 下摆） */}
      <path
        d="M140 210 C120 216 96 236 84 268 C72 300 66 340 64 380 L64 520 L296 520 C296 480 294 430 288 384 C282 336 268 296 248 266 C232 242 208 228 196 224 C180 216 158 210 140 210 Z"
        fill="#2c3e50"
      />
      {/* 长袍衣领 */}
      <path d="M176 222 C200 228 224 228 244 244" stroke="#f6ecdc" strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* 长袍褶皱（纸色细线） */}
      <path d="M118 300 C150 320 200 330 250 322" stroke="#f6ecdc" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d="M108 400 C160 420 220 428 272 420" stroke="#f6ecdc" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d="M100 468 C150 484 210 490 264 484" stroke="#f6ecdc" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7" />

      {/* 头发（头顶卷发，覆盖前额） */}
      <path
        d="M132 108 C130 62 158 30 202 26 C246 22 282 48 288 84 C296 64 292 40 274 26 C256 12 220 8 194 14 C158 22 134 56 132 108 Z"
        fill="#2c3e50"
      />

      {/* 侧脸轮廓（额头 → 鼻梁 → 鼻尖 → 人中 → 嘴唇 → 下巴） */}
      <path
        d="M188 96 C198 84 210 82 218 88 L236 108 C244 118 248 124 250 128 L234 134 C232 140 230 146 230 150 L244 158 C240 164 236 168 234 172 L238 178 C226 190 216 196 208 202"
        fill="#2c3e50"
      />

      {/* 大胡子（从鼻下沿脸颊垂到胸前，分缕波浪） */}
      <path
        d="M230 130 C244 148 252 172 250 196 C248 220 238 236 232 252 C224 272 224 292 230 310 C240 320 254 322 260 314 C252 296 250 276 248 260 C250 276 248 296 244 314 C236 322 220 324 212 316 C200 296 196 272 200 248 C204 224 210 206 218 192 C204 182 190 172 184 160 C176 146 176 134 180 124 C190 130 206 132 218 130 C222 130 226 130 230 130 Z"
        fill="#2c3e50"
      />
      {/* 胡子分缕（纸色细线） */}
      <path d="M214 200 C206 220 204 248 212 272" stroke="#f6ecdc" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M232 208 C236 232 234 258 228 282" stroke="#f6ecdc" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.7" />
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
    <div className="welcome-paper flex min-h-screen">
      {/* 左半屏：苏格拉底侧脸剪影 */}
      <div className="hidden flex-1 items-center justify-center sm:flex sm:w-1/2">
        <SocratesSilhouette className="max-h-[86vh] w-auto max-w-full px-6 py-10" />
      </div>

      {/* 右半屏：品牌 + 宣传语 + CTA */}
      <main className="flex flex-1 flex-col items-start justify-center px-8 py-16 sm:w-1/2 sm:px-14">
        {/* 移动端小剪影 */}
        <div className="mb-6 flex justify-center sm:hidden">
          <SocratesSilhouette className="h-40 w-auto" />
        </div>

        <h1
          className="font-mono text-5xl font-bold tracking-[0.12em] sm:text-6xl"
          style={{ color: "#2c3e50" }}
        >
          {BRAND.slice(0, printed)}
          <span className="type-cursor" style={{ display: printed >= BRAND.length ? "none" : "inline-block" }} />
        </h1>

        {showTag && (
          <p className="welcome-fade mt-5 max-w-md text-sm leading-relaxed tracking-wide sm:text-base" style={{ color: "rgba(44,62,80,0.72)" }}>
            {TAGLINE}
          </p>
        )}

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
