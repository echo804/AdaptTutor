"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

/** 欢迎页（M4r9d）：淡黄素描纸 + 左侧深灰苏格拉底雕像头像水印（无五官侧脸）+ 右侧哲思文案。
 * 已登录 → 直接进入 /chat；未登录 → 展示欢迎页 + 登录/注册 CTA。
 */

const BRAND = "AdaptTutor";
const TITLE = "不是给予答案，而是唤醒思考";

/** 苏格拉底雕像头像剪影：古希腊风格 bust（卷发 + 无五官侧脸轮廓 + 肩），深灰水印 */
function SocratesWatermark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 520"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="#3f3f46" opacity="0.38">
        {/* 肩 / 雕像底座 */}
        <path d="M206 316 C202 328 200 342 200 356 L200 388 L158 408 C146 420 140 438 140 458 L140 520 L392 520 C392 458 386 414 372 374 C360 338 342 314 318 298 C302 286 288 278 276 274 C262 268 248 264 240 264 C238 270 238 278 240 286 C242 294 238 300 236 306 C230 306 218 310 206 316 Z" />
        {/* 脖子（雕像柱式颈） */}
        <path d="M202 296 C198 306 196 318 196 332 L196 352 L240 352 L240 332 C240 318 238 306 234 296 C226 290 210 290 202 296 Z" />
        {/* 头：无五官侧脸轮廓（额 → 鼻 → 唇 → 下巴 → 后脑） */}
        <path d="M168 132 C168 78 200 44 248 40 C296 36 332 66 336 106 C340 118 340 130 336 140 C332 150 326 156 320 160 L300 170 C296 176 294 182 294 188 C294 196 296 202 300 208 L282 212 C280 220 280 226 282 232 C286 236 290 240 292 244 C288 250 282 256 278 262 C274 270 272 278 272 286 C272 296 276 304 282 312 C278 320 272 326 264 330 C256 334 248 334 242 330 C232 324 226 316 222 306 C218 296 216 284 216 272 C216 258 218 244 222 232 C212 226 204 218 200 206 C196 192 196 176 200 162 C190 156 180 148 174 136 C168 124 168 116 168 132 Z" />
        {/* 卷发（覆盖头顶与后脑） */}
        <path d="M168 128 C168 74 200 40 248 36 C296 32 332 62 336 102 C340 92 338 74 328 58 C318 42 296 30 272 26 C246 22 216 24 194 34 C170 46 156 72 168 128 Z" />
        {/* 额前卷发缕 */}
        <path d="M332 96 C340 88 344 74 340 60 C336 46 324 38 312 36" fill="none" stroke="#3f3f46" strokeWidth="7" strokeLinecap="round" opacity="0.8" />
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
    <div className="welcome-paper min-h-screen">
      {/* 左半屏：深灰雕像头像水印 */}
      <SocratesWatermark className="pointer-events-none absolute left-0 top-0 hidden h-full w-[46vw] sm:block" />

      {/* 右半屏：品牌 + 标题 + CTA（垂直居中） */}
      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-8 py-16 sm:ml-[46vw] sm:items-start sm:pl-4 sm:pr-16">
        {/* 移动端小水印 */}
        <div className="mb-8 flex justify-center sm:hidden">
          <SocratesWatermark className="h-44 w-auto" />
        </div>

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
          <div className="welcome-fade mt-10 flex flex-col items-center gap-4 sm:items-start">
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
          <p className="welcome-fade mt-12 text-[11px] tracking-widest" style={{ color: "rgba(44,62,80,0.4)" }}>
            初中数学 · 大模型应用开发 · 更多领域持续加入
          </p>
        )}
      </main>
    </div>
  );
}
