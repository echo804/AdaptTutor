"use client";

/** 复古笔记风装饰物（M4r10）：手绘线条 SVG，淡墨色 + 琥珀点缀，低透明不抢焦点。
 * 全部用 <path>/<line> 勾线，无填色，与欢迎页素描纸语言一致。
 */

const INK = "rgba(44,62,80,0.18)"; // 淡墨线
const AMBER = "rgba(212,165,116,0.55)"; // 琥珀点缀

/** 羽毛笔 + 墨水瓶（左上） */
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

/** 回形针（右上） */
export function PaperClip({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <path
        d="M62 22 c22 0 30 8 30 26 v34 c0 16 -8 24 -22 24 c-18 0 -26 -10 -26 -26 v-38 c0 -12 6 -18 16 -18 c12 0 18 8 18 20 v32"
        fill="none"
        stroke={INK}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 铅笔（左下） */
export function Pencil({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      {/* 笔身 */}
      <path d="M22 34 h68 l4 6 -68 64 -10 -6 z" fill="none" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M30 42 h56" stroke={INK} strokeWidth="1.2" />
      <path d="M26 52 h52" stroke={INK} strokeWidth="1.2" />
      <path d="M22 62 h48" stroke={INK} strokeWidth="1.2" />
      {/* 笔尖 */}
      <path d="M88 40 l16 -10 -4 14 z" fill={AMBER} opacity="0.6" />
      {/* 橡皮 */}
      <path d="M16 34 a8 8 0 0 1 8 -6 h4 l4 6 -8 8 -8 -8 z" fill="none" stroke={INK} strokeWidth="1.6" />
      <path d="M28 28 l4 6 -8 8 -8 -8 8 -6" stroke={INK} strokeWidth="1.2" />
    </svg>
  );
}

/** 放大镜（右下） */
export function Magnifier({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <circle cx="48" cy="48" r="26" fill="none" stroke={INK} strokeWidth="3" />
      {/* 镜内高光 */}
      <path d="M38 40 a12 12 0 0 1 8 -6" fill="none" stroke={AMBER} strokeWidth="2.4" strokeLinecap="round" />
      {/* 镜柄 */}
      <path d="M68 68 l24 24" stroke={INK} strokeWidth="3" strokeLinecap="round" />
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
