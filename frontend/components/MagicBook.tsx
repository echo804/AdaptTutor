"use client";

import { useThemeVar } from "@/lib/theme";
import type { BookInfo } from "@/lib/bookshelf";

/** 魔法书（M4r11）：复古魔法书 SVG——深色皮质封面 + 烫金书名 + 书脊 + 金属角饰。
 * 封面角标：星群表示掌握进度（5 星，按 percent 点亮琥珀/暗灰）。
 */

const GOLD = "#d4a574"; // 烫金
const GOLD_DIM = "rgba(212,165,116,0.35)";
const LEATHER = ["#3a2a20", "#2c2018", "#241a13"]; // 深棕皮质
const STAR_COUNT = 5;

interface MagicBookProps {
  book: BookInfo;
  active?: boolean;
  onOpen?: () => void;
}

export default function MagicBook({ book, active, onOpen }: MagicBookProps) {
  const amber = useThemeVar("--amber", GOLD);
  const litStars = Math.round(book.percent * STAR_COUNT);
  const title = book.subject.length > 6 ? `${book.subject.slice(0, 6)}…` : book.subject;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`打开《${book.subject}》魔法书`}
      className="group relative block cursor-pointer border-none bg-transparent p-0 text-left outline-none"
    >
      {/* 书体：封面 + 书脊 */}
      <svg viewBox="0 0 150 200" className="h-48 w-36 drop-shadow-[0_10px_18px_rgba(20,14,8,0.45)] transition-transform duration-300 group-hover:-translate-y-2 group-hover:drop-shadow-[0_16px_26px_rgba(20,14,8,0.55)]" aria-hidden>
        <defs>
          <linearGradient id={`leather-${book.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={LEATHER[0]} />
            <stop offset="55%" stopColor={LEATHER[1]} />
            <stop offset="100%" stopColor={LEATHER[2]} />
          </linearGradient>
          <radialGradient id={`glow-${book.id}`} cx="0.5" cy="0.3" r="0.9">
            <stop offset="0%" stopColor={active ? "rgba(212,165,116,0.28)" : "rgba(212,165,116,0.10)"} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>

        {/* 书脊（左侧立体边） */}
        <path d="M14 6 L26 12 L26 190 L14 196 Z" fill="#1d150e" />
        {/* 书脊装饰线 */}
        <line x1="19" y1="22" x2="19" y2="180" stroke={GOLD_DIM} strokeWidth="1.4" />

        {/* 封面主体 */}
        <rect x="26" y="4" width="122" height="192" rx="4" fill={`url(#leather-${book.id})`} stroke="#0f0a06" strokeWidth="1.5" />
        {/* 封面高光渐变 */}
        <rect x="26" y="4" width="122" height="192" rx="4" fill={`url(#glow-${book.id})`} />

        {/* 封面烫金内框 */}
        <rect x="34" y="12" width="106" height="176" rx="2" fill="none" stroke={GOLD} strokeWidth="1.6" opacity="0.75" />
        <rect x="40" y="18" width="94" height="164" rx="2" fill="none" stroke={GOLD_DIM} strokeWidth="0.8" />

        {/* 四角金属角饰 */}
        <path d="M34 12 L52 12 L52 20 L42 20 L42 30 L34 30 Z" fill={GOLD} opacity="0.9" />
        <path d="M124 12 L124 30 L116 30 L116 20 L106 20 L106 12 Z" fill={GOLD} opacity="0.9" />
        <path d="M34 188 L34 170 L42 170 L42 180 L52 180 L52 188 Z" fill={GOLD} opacity="0.9" />
        <path d="M124 188 L106 188 L106 180 L116 180 L116 170 L124 170 Z" fill={GOLD} opacity="0.9" />

        {/* 中央烫金书名 */}
        <text
          x="87"
          y="86"
          textAnchor="middle"
          fill={GOLD}
          fontSize="15"
          fontWeight="700"
          letterSpacing="1.5"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          {title}
        </text>
        {/* 书名下装饰线 */}
        <line x1="52" y1="96" x2="122" y2="96" stroke={GOLD} strokeWidth="1" opacity="0.6" />
        <circle cx="87" cy="100" r="1.6" fill={GOLD} opacity="0.8" />

        {/* 封面底部：掌握度星群 */}
        <g>
          {Array.from({ length: STAR_COUNT }, (_, i) => {
            const lit = i < litStars;
            const cx = 62 + i * 12.5;
            return (
              <g key={i}>
                <path
                  d={`M${cx} 158 l2.6 5.2 5.8 0.8 -4.2 4.1 1 5.7 -5.2 -2.7 -5.2 2.7 1 -5.7 -4.2 -4.1 5.8 -0.8 z`}
                  fill={lit ? amber : "rgba(148,163,184,0.35)"}
                  stroke={lit ? GOLD_DIM : "rgba(148,163,184,0.25)"}
                  strokeWidth="0.6"
                />
              </g>
            );
          })}
        </g>
        {/* 进度文字 */}
        <text x="87" y="183" textAnchor="middle" fill="rgba(212,165,116,0.65)" fontSize="8.5" letterSpacing="1" fontFamily="Georgia, serif">
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
