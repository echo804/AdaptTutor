"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/** 欢迎页（M4r9f）：淡黄素描纸 + 正中苏格拉底正面雕像剪影（卷发环绕头像）+ 文字浮于剪影上。
 * 已登录 → 直接进入 /chat；未登录 → 展示欢迎页 + 登录/注册 CTA。
 */

const BRAND = "AdaptTutor";
const TITLE = "不是给予答案，而是唤醒思考";

/** 苏格拉底正面头像剪影：古希腊雕像正面（蛋形脸轮廓 + 卷发帽环绕 + 两侧垂发），深灰水印 */
function SocratesWatermark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 480"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="#3f3f46" opacity="0.34">
        {/* 脸：正面蛋形轮廓（无五官） */}
        <path d="M210 70 C270 70 310 125 310 200 C310 275 275 330 210 340 C145 330 110 275 110 200 C110 125 150 70 210 70 Z" />
        {/* 头顶卷发帽（覆盖头顶，两端垂到耳侧） */}
        <path d="M120 172 C98 118 140 58 210 54 C280 58 322 118 300 172 C322 128 312 86 282 64 C252 42 168 42 138 64 C108 86 98 128 120 172 Z" />
        {/* 左侧垂发（脸颊旁卷发绺） */}
        <path d="M118 176 C100 202 96 242 104 284 C96 262 88 232 90 202 C92 172 104 162 118 176 Z" />
        {/* 右侧垂发 */}
        <path d="M302 176 C320 202 324 242 316 284 C324 262 332 232 330 202 C328 172 316 162 302 176 Z" />
        {/* 额前卷发（帽缘波浪，中缝一缕） */}
        <path d="M178 66 C168 92 170 120 182 144" fill="none" stroke="#3f3f46" strokeWidth="7" strokeLinecap="round" opacity="0.85" />
        <path d="M222 62 C232 88 230 116 218 140" fill="none" stroke="#3f3f46" strokeWidth="6" strokeLinecap="round" opacity="0.85" />
        <path d="M140 132 C124 150 116 172 114 196" fill="none" stroke="#3f3f46" strokeWidth="6" strokeLinecap="round" opacity="0.8" />
        <path d="M280 132 C296 150 304 172 306 196" fill="none" stroke="#3f3f46" strokeWidth="6" strokeLinecap="round" opacity="0.8" />
      </g>
    </svg>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const [printed, setPrinted] = useState(0); // 已打印字符数
  const [showTitle, setShowTitle] = useState(false);
  const [showCta, setShowCta] = useState(false);

  // 已登录直接进应用（不等动画，避免闪烁）
  useEffect(() => {
    if (getToken()) router.replace("/chat");
  }, [router]);

  // 品牌名逐字打印 → 标题 → CTA
  useEffect(() => {
    if (printed < BRAND.length) {
      const t = setTimeout(() => setPrinted((p) => p + 1), 110);
      return () => clearTimeout(t);
    }
    if (!showTitle) {
      const t = setTimeout(() => setShowTitle(true), 300);
      return () => clearTimeout(t);
    }
    if (!showCta) {
      const t = setTimeout(() => setShowCta(true), 500);
      return () => clearTimeout(t);
    }
  }, [printed, showTitle, showCta]);

  return (
    <div className="welcome-paper relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* 中屏正面剪影（水印层，z-0） */}
      <SocratesWatermark className="pointer-events-none absolute z-0 w-[68vw] max-w-[700px]" />

      {/* 文字浮于剪影上（z-10） */}
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
          <div className="welcome-fade mt-10 flex flex-col items-center gap-4">
            <Link
              href="/register"
              className="rounded-full px-10 py-3.5 text-sm font-medium transition-transform hover:scale-105 hover:opacity-90"
              style={{ background: "var(--amber)", color: "#1a1a1a", boxShadow: "0 4px 20px rgba(212,165,116,0.45)" }}
            >
              开启思辨之旅
            </Link>
            <Link
              href="/login"
              className="text-sm transition-opacity hover:opacity-70"
              style={{ color: "rgba(44,62,80,0.6)" }}
            >
              已有账号？登录
            </Link>
          </div>
        )}

        {showCta && (
          <p className="welcome-fade mt-10 text-[11px] tracking-widest" style={{ color: "rgba(44,62,80,0.4)" }}>
            初中数学 · 大模型应用开发 · 更多领域持续加入
          </p>
        )}
      </main>
    </div>
  );
}
