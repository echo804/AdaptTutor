"use client";

/** 复古笔记风装饰物（M4r10c）：手绘线条 SVG，淡墨色 + 琥珀点缀，低透明不抢焦点。
 * 全部用 <path>/<line>/<circle> 勾线，无填色，复古文艺风：羽毛笔/眼镜/枫叶/羽毛。
 */

const INK = "rgba(44,62,80,0.18)"; // 淡墨线
const AMBER = "rgba(212,165,116,0.55)"; // 琥珀点缀

/** 羽毛笔 + 墨水瓶 */
export function QuillInk({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      {/* 墨水瓶 */}
      <path d="M45 78 h30 l6 14 h-42 z" fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M52 92 a16 16 0 0 0 16 0" fill="none" stroke={INK} strokeWidth="1.6" />
      <path d="M52 92 h16" stroke={INK} strokeWidth="1.2" />
      <path d="M56 82 h8 l1 8 h-10 z" fill={AMBER} opacity="0.5" />
      {/* 瓶颈 */}
      <path d="M56 64 h8 v8 h-8 z" fill="none" stroke={INK} strokeWidth="1.6" />
      {/* 瓶盖 */}
      <path d="M54 58 h12 v6 h-12 z" fill="none" stroke={INK} strokeWidth="1.6" />
      {/* 羽毛笔 */}
      <path d="M68 56 q28 -30 24 -52" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      {/* 羽毛叶片（左） */}
      <path d="M74 50 q20 -2 16 -26" fill="none" stroke={INK} strokeWidth="1.3" />
      <path d="M77 44 q15 -4 12 -20" fill="none" stroke={INK} strokeWidth="1.1" />
      {/* 羽毛叶片（右） */}
      <path d="M82 48 q24 -8 18 -30" fill="none" stroke={INK} strokeWidth="1.3" />
      <path d="M84 40 q18 -8 13 -22" fill="none" stroke={INK} strokeWidth="1.1" />
      {/* 笔尖 */}
      <path d="M92 4 l2 10 -4 2 z" fill={AMBER} opacity="0.6" />
    </svg>
  );
}

/** 圆框眼镜（复古文艺） */
export function Glasses({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      {/* 左镜片 */}
      <circle cx="42" cy="58" r="22" fill="none" stroke={INK} strokeWidth="2.2" />
      {/* 右镜片 */}
      <circle cx="84" cy="58" r="22" fill="none" stroke={INK} strokeWidth="2.2" />
      {/* 鼻梁桥 */}
      <path d="M64 58 q-2 -6 2 -6" fill="none" stroke={INK} strokeWidth="2" />
      {/* 左镜腿 */}
      <path d="M20 58 q-6 2 -10 14" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      {/* 右镜腿 */}
      <path d="M106 58 q6 2 10 14" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      {/* 镜片琥珀微光 */}
      <path d="M34 50 a14 14 0 0 1 10 -8" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <path d="M76 50 a14 14 0 0 1 10 -8" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** 枫叶（复古文艺） */
export function MapleLeaf({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      {/* 枫叶轮廓：五裂掌状 */}
      <path
        d="M60 14 q6 14 2 26 l16 -12 q-4 16 -14 22 l20 2 q-8 14 -22 10 l10 20 q-14 -2 -18 -16 l-10 18 q-10 -12 -4 -26 l-18 10 q2 -16 14 -20 l-16 -8 q10 -12 22 -8 l-4 -18 q12 4 14 16 z"
        fill="none"
        stroke={INK}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* 主叶脉 */}
      <path d="M60 14 q2 26 0 44 l-2 40" fill="none" stroke={INK} strokeWidth="1.2" />
      {/* 侧叶脉 */}
      <path d="M60 32 q-10 2 -16 10" fill="none" stroke={INK} strokeWidth="1" />
      <path d="M60 32 q10 2 16 10" fill="none" stroke={INK} strokeWidth="1" />
      <path d="M60 44 q-8 4 -12 12" fill="none" stroke={INK} strokeWidth="1" />
      <path d="M60 44 q8 4 12 12" fill="none" stroke={INK} strokeWidth="1" />
      {/* 琥珀色叶尖点缀 */}
      <path d="M60 14 l1 4" stroke={AMBER} strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** 单片羽毛（复古文艺） */
export function Feather({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      {/* 羽轴 */}
      <path d="M18 102 q40 -36 78 -76" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      {/* 左羽片 */}
      <path d="M40 82 q26 -6 22 -34" fill="none" stroke={INK} strokeWidth="1.3" />
      <path d="M52 72 q20 -8 16 -30" fill="none" stroke={INK} strokeWidth="1.1" />
      <path d="M62 64 q16 -8 12 -26" fill="none" stroke={INK} strokeWidth="1.1" />
      {/* 右羽片 */}
      <path d="M50 84 q30 -14 26 -42" fill="none" stroke={INK} strokeWidth="1.3" />
      <path d="M58 76 q24 -12 18 -34" fill="none" stroke={INK} strokeWidth="1.1" />
      {/* 羽根（管状末端） */}
      <path d="M18 102 q4 6 10 8" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      {/* 琥珀羽尖 */}
      <path d="M96 26 l3 -3" stroke={AMBER} strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** 小墨点（散布） */
export function InkDots({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 100" className={className} aria-hidden>
      <circle cx="20" cy="40" r="2.2" fill={INK} />
      <circle cx="52" cy="18" r="1.6" fill={INK} opacity="0.7" />
      <circle cx="120" cy="64" r="2" fill={INK} opacity="0.6" />
      <circle cx="160" cy="30" r="1.4" fill={INK} opacity="0.5" />
      <circle cx="90" cy="80" r="1.8" fill={INK} opacity="0.45" />
      <circle cx="180" cy="70" r="1.2" fill={INK} opacity="0.4" />
    </svg>
  );
}
