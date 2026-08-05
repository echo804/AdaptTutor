"use client";

import { transformHex, useThemeVar } from "@/lib/theme";
import type { BookInfo } from "@/lib/bookshelf";

/** 魔法书（M4r11e）：封面皮质从主题主色（--accent）派生，随色板/明暗联动。
 * 点亮书：主色压暗成深皮（色相跟随主题）；蒙尘书：主色降饱和 + 提亮成旧皮灰。
 * 烫金书名/星群/角饰仍用琥珀系（--amber）。
 */

const GOLD = "#d4a574"; // 烫金
const GOLD_DIM = "rgba(212,165,116,0.35)";
const STAR_COUNT = 5;

interface MagicBookProps {
  book: BookInfo;
  active?: boolean;
  onOpen?: () => void;
}

export default function MagicBook({ book, active, onOpen }: MagicBookProps) {
  const amber = useThemeVar("--amber", GOLD);
  const accent = useThemeVar("--accent", "#2c3e50");
  const litStars = Math.round(book.percent * STAR_COUNT);
  const lit = book.mastered > 0; // 已点亮：mastered > 0 → 高亮慢闪；否则蒙尘
  const title = book.subject.length > 6 ? `${book.subject.slice(0, 6)}…` : book.subject;
  // 皮质渐变（主色派生）：点亮=深皮三阶；蒙尘=降饱和提亮的旧皮三阶
  const leather = lit
    ? [transformHex(accent, { lightness: 0.24 }), transformHex(accent, { lightness: 0.18 }), transformHex(accent, { lightness: 0.12 })]
    : [transformHex(accent, { saturation: 0.25, lightness: 0.40 }), transformHex(accent, { saturation: 0.22, lightness: 0.32 }), transformHex(accent, { saturation: 0.20, lightness: 0.26 })];

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`打开《${book.subject}》魔法书`}
      className={`group relative block cursor-pointer border-none bg-transparent p-0 text-left outline-none ${lit ? "magic-book-lit" : ""}`}
    >
      {/* 书体：封面 + 书脊 */}
      <svg viewBox="0 0 150 200" className="h-48 w-36 drop-shadow-[0_10px_18px_rgba(90,82,72,0.4)] transition-transform duration-300 group-hover:-translate-y-2 group-hover:drop-shadow-[0_16px_26px_rgba(90,82,72,0.5)]" aria-hidden>
        <defs>
          <linearGradient id={`leather-${book.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={leather[0]} />
            <stop offset="55%" stopColor={leather[1]} />
            <stop offset="100%" stopColor={leather[2]} />
          </linearGradient>
          <radialGradient id={`glow-${book.id}`} cx="0.5" cy="0.3" r="0.9">
            <stop offset="0%" stopColor={lit ? "rgba(212,165,116,0.30)" : "rgba(212,165,116,0.06)"} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        {/* 书脊（左侧立体边） */}
        <path d="M14 6 L26 12 L26 190 L14 196 Z" fill="#241b14" />
        {/* 书脊装饰线（随主题副强调色） */}
        <line x1="19" y1="22" x2="19" y2="180" stroke={lit ? GOLD_DIM : "rgba(180,175,165,0.4)"} strokeWidth="1.4" />

        {/* 封面主体 */}
        <rect x="26" y="4" width="122" height="192" rx="4" fill={`url(#leather-${book.id})`} stroke="#191310" strokeWidth="1.5" />
        {/* 封面高光渐变 */}
        <rect x="26" y="4" width="122" height="192" rx="4" fill={`url(#glow-${book.id})`} />

        {/* ---- 未点亮：灰尘颗粒 + 蜘蛛网 ---- */}
        {!lit && (
          <g>
            {/* 灰尘颗粒（细点散布封面） */}
            {[
              [38, 30], [120, 26], [46, 60], [112, 52], [40, 120], [122, 130],
              [58, 168], [108, 175], [98, 90], [66, 108], [128, 80], [36, 86],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.4 : 0.9} fill="rgba(230,225,215,0.5)" />
            ))}
            {/* 灰尘结块（封面边角） */}
            <path d="M30 8 q4 3 8 0 q0 4 -4 6 q-6 0 -4 -6 z" fill="rgba(230,225,215,0.35)" />
            <path d="M122 186 q6 2 8 6 q-6 0 -8 -6 z" fill="rgba(230,225,215,0.3)" />
            {/* 左上角蜘蛛网：放射线 + 弧线 */}
            <g stroke="rgba(225,220,210,0.55)" strokeWidth="0.7" fill="none">
              <path d="M34 10 L54 14 M34 10 L44 30 M34 10 L30 30" />
              <path d="M39 14 q6 4 12 2" />
              <path d="M37 20 q6 8 12 10" />
              <path d="M34 17 q2 6 0 10" />
            </g>
          </g>
        )}

        {/* 封面烫金内框（蒙尘书褪色） */}
        <rect x="34" y="12" width="106" height="176" rx="2" fill="none" stroke={lit ? GOLD : "rgba(212,165,116,0.4)"} strokeWidth="1.6" opacity={lit ? 0.75 : 0.55} />
        <rect x="40" y="18" width="94" height="164" rx="2" fill="none" stroke={GOLD_DIM} strokeWidth="0.8" />

        {/* 四角金属角饰（蒙尘书变暗） */}
        <path d="M34 12 L52 12 L52 20 L42 20 L42 30 L34 30 Z" fill={lit ? GOLD : "rgba(148,163,184,0.45)"} opacity="0.9" />
        <path d="M124 12 L124 30 L116 30 L116 20 L106 20 L106 12 Z" fill={lit ? GOLD : "rgba(148,163,184,0.45)"} opacity="0.9" />
        <path d="M34 188 L34 170 L42 170 L42 180 L52 180 L52 188 Z" fill={lit ? GOLD : "rgba(148,163,184,0.45)"} opacity="0.9" />
        <path d="M124 188 L106 188 L106 180 L116 180 L116 170 L124 170 Z" fill={lit ? GOLD : "rgba(148,163,184,0.45)"} opacity="0.9" />

        {/* 中央烫金书名（蒙尘书用灰金） */}
        <text
          x="87"
          y="86"
          textAnchor="middle"
          fill={lit ? GOLD : "rgba(180,175,165,0.75)"}
          fontSize="15"
          fontWeight="700"
          letterSpacing="1.5"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          {title}
        </text>
        {/* 书名下装饰线 */}
        <line x1="52" y1="96" x2="122" y2="96" stroke={lit ? GOLD : "rgba(180,175,165,0.5)"} strokeWidth="1" opacity="0.6" />
        <circle cx="87" cy="100" r="1.6" fill={lit ? GOLD : "rgba(180,175,165,0.6)"} opacity="0.8" />

        {/* 封面底部：掌握度星群 */}
        <g>
          {Array.from({ length: STAR_COUNT }, (_, i) => {
            const litStar = i < litStars;
            const cx = 62 + i * 12.5;
            return (
              <g key={i}>
                <path
                  d={`M${cx} 158 l2.6 5.2 5.8 0.8 -4.2 4.1 1 5.7 -5.2 -2.7 -5.2 2.7 1 -5.7 -4.2 -4.1 5.8 -0.8 z`}
                  fill={litStar ? amber : "rgba(148,163,184,0.35)"}
                  stroke={litStar ? GOLD_DIM : "rgba(148,163,184,0.25)"}
                  strokeWidth="0.6"
                />
              </g>
            );
          })}
        </g>
        {/* 进度文字 */}
        <text x="87" y="183" textAnchor="middle" fill={lit ? "rgba(212,165,116,0.65)" : "rgba(180,175,165,0.6)"} fontSize="8.5" letterSpacing="1" fontFamily="Georgia, serif">
          {Math.round(book.percent * 100)}%
        </text>
      </svg>

      {/* 书下方：领域名 + 节点数（HTML，便于换行） */}
      <div className="mt-2 max-w-36 text-center">
        <div className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
          {book.subject}
        </div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {book.total} 知识点 · {book.mastered} 已点亮
        </div>
      </div>
    </button>
  );
}
