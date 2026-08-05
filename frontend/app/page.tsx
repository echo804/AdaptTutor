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

/** 苏格拉底正面头部剪影：古希腊大理石雕像轮廓（宽阔额头 + 茂密卷曲短发 + 浓密大胡须，无五官） */
function SocratesWatermark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 500"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="#2c3e50" opacity="0.5">
        {/* 头 + 大胡须一体轮廓（宽阔额头，无五官） */}
        <path d="M210 58 C280 58 322 100 322 160 C322 190 316 220 302 246 C294 264 284 282 272 296 C266 316 262 336 264 356 C266 380 274 400 288 414 C298 424 308 432 316 442 C292 448 264 450 238 446 C222 443 210 442 210 444 C210 442 198 443 182 446 C156 450 128 448 104 442 C112 432 122 424 132 414 C146 400 154 380 156 356 C158 336 154 316 148 296 C136 282 126 264 118 246 C104 220 98 190 98 160 C98 100 140 58 210 58 Z" />
        {/* 茂密卷曲短发帽（覆盖头顶，外缘卷曲波浪） */}
        <path d="M98 168 C94 128 104 92 128 68 C152 44 180 30 210 30 C240 30 268 44 292 68 C316 92 326 128 322 168 C330 136 326 102 310 76 C294 50 268 34 240 30 C212 26 188 28 164 36 C138 46 116 64 102 90 C90 114 86 142 98 168 Z" />
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
