"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";
import Magnet from "@/components/reactbits/Magnet";
import DecryptedText from "@/components/reactbits/DecryptedText";
import RotatingText from "@/components/reactbits/RotatingText";

/** 欢迎页（M4r9k + M6.1）：淡黄素描纸 + 精细单线手绘苏格拉底完整人物线稿（无文字） + 文字浮于其上。
 * 素材：用户从 AI 生成图中裁出的完整人物线稿（波浪卷发/长胡须/分层排线），透明背景。
 * 已登录 → 直接进入 /chat；未登录 → 展示欢迎页 + 登录/注册 CTA。
 * M6.1 动效：品牌名 DecryptedText 逐字解密 + RotatingText 哲思句轮换 + Magnet CTA 磁吸。
 * 文字运动语言统一（字符级逐字变换），品牌名→副标题→CTA 从容递进浮现。
 */

const BRAND = "AdaptTutor";
const TITLES = [
  "不是给予答案，而是唤醒思考",
  "问题，比答案更珍贵",
  "每一次错误，都是思考的路径",
];

export default function WelcomePage() {
  const router = useRouter();
  const [showTitle, setShowTitle] = useState(false);   // 哲思标题（品牌名解密完成后出现）
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

  // 品牌名逐字解密（DecryptedText 内部处理，约 9 字符 × 150ms ≈ 1.35s）→ 标题 → 按钮 → 登录（各段独立浮现，节奏从容）
  useEffect(() => {
    if (!showTitle) {
      const t = setTimeout(() => setShowTitle(true), 1450);
      return () => clearTimeout(t);
    }
    if (!showCta) {
      const t = setTimeout(() => setShowCta(true), 1300);
      return () => clearTimeout(t);
    }
    if (!showLogin) {
      const t = setTimeout(() => setShowLogin(true), 1100);
      return () => clearTimeout(t);
    }
  }, [showTitle, showCta, showLogin]);

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
            <DecryptedText
              text={BRAND}
              sequential
              speed={150}
              maxIterations={3}
              useOriginalCharsOnly
              revealDirection="start"
              animateOn="view"
            />
          </h1>

        {showTitle && (
          <RotatingText
            texts={TITLES}
            mainClassName="mt-6 min-h-[2.25rem] text-xl font-light leading-relaxed tracking-wide sm:min-h-[2.5rem] sm:text-2xl"
            splitLevelClassName="overflow-hidden pb-0.5"
            staggerDuration={0.04}
            rotationInterval={7000}
            animatePresenceInitial
            transition={{ type: "tween", duration: 0.45, ease: "easeInOut" }}
            style={{ color: "rgba(44,62,80,0.85)" }}
          />
        )}

        {showCta && (
          <div className="welcome-rise mt-10">
            <Magnet padding={26} magnetStrength={45}>
              <Link
                href="/register"
                className="inline-block rounded-full px-10 py-3.5 text-sm font-medium transition-transform hover:scale-105 hover:opacity-90"
                style={{ background: "var(--amber)", color: "#1a1a1a", boxShadow: "0 4px 20px rgba(212,165,116,0.45)" }}
              >
                开启思辨之旅
              </Link>
            </Magnet>
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
