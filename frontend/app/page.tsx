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

/** 苏格拉底正面大头照剪影：国字脸（方额/直颊/方腮）+ 茂密卷曲短发 + 浓密大胡须，无五官、无脖子 */
function SocratesWatermark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 480"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="#2c3e50" opacity="0.5">
        {/* 国字脸 + 大胡须一体轮廓（方额 → 直颊 → 方腮 → 浓密胡须） */}
        <path d="M210 60 C270 60 306 92 312 138 L316 178 C318 210 314 240 306 262 L300 292 C296 312 294 330 296 348 C298 372 306 394 318 408 C330 418 340 424 344 432 C316 438 286 440 258 436 C242 433 226 431 210 432 C194 431 178 433 162 436 C134 440 104 438 76 432 C80 424 90 418 102 408 C114 394 122 372 124 348 C126 330 124 312 120 292 L114 262 C106 240 102 210 104 178 L108 138 C114 92 150 60 210 60 Z" />
        {/* 茂密卷曲短发帽（覆盖头顶，外缘卷曲波浪） */}
        <path d="M108 168 C104 128 114 92 138 68 C162 44 190 30 210 30 C230 30 258 44 282 68 C306 92 316 128 312 168 C320 136 316 102 300 76 C284 50 258 34 230 30 C202 26 178 28 154 36 C128 46 106 64 92 90 C80 114 76 142 108 168 Z" />
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
