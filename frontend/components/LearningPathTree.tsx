"use client";

import { useThemeVar } from "@/lib/theme";

/** 缩略版星系路径（M4r7 需求 4，呼应 3D 宇宙）：
 * - 背景微星空点 + 每个行星的轨道椭圆环
 * - 行星节点：径向渐变（受光面亮/背光暗）+ 光晕；掌握度冷灰→暖绿着色
 * - 根因：暖色 + 呼吸脉冲环；路径链虚线暖色流动
 */

interface LearningPathTreeProps {
  path: string[];
  mastery: Record<string, number>;
  names?: Record<string, string>;
  height?: number;
}

const COLD = [148, 163, 184];
const WARM = [126, 200, 160];

function color(p?: number) {
  if (p === undefined) return "rgba(148,163,184,0.5)";
  const t = Math.max(0, Math.min(1, p));
  const ch = (i: number) => Math.round(COLD[i] + (WARM[i] - COLD[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

export default function LearningPathTree({ path, mastery, names, height = 150 }: LearningPathTreeProps) {
  const n = path.length;
  if (n === 0) return null;
  // 主题强调色（根因暖色描边/脉冲环，随色板切换）
  const amber = useThemeVar("--amber", "#d4a574");
  const padX = 40;
  const nodeR = 17;
  const step = n > 1 ? (100 - padX * 2) / (n - 1) : 0;
  const cy = height / 2;

  const nodes = path.map((id, i) => {
    const x = padX + (n > 1 ? i * step : 0);
    return { id, cx: (x / 100) * 1000, i };
  });

  // 背景星点（伪随机但稳定）
  const stars = Array.from({ length: 26 }, (_, k) => ({
    x: ((k * 37) % 97) + 1.5,
    y: ((k * 53) % 92) + 4,
    r: 0.5 + ((k * 7) % 10) / 9,
    o: 0.25 + ((k * 13) % 30) / 60,
  }));

  return (
    <svg viewBox={`0 0 1000 ${height}`} className="w-full" role="img" aria-label="学习路径星系图">
      <defs>
        <radialGradient id="planetGrad" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.55} />
          <stop offset="45%" stopColor="#ffffff" stopOpacity={0.08} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0.35} />
        </radialGradient>
      </defs>

      {/* 背景星点 */}
      {stars.map((s, k) => (
        <circle key={k} cx={s.x * 10} cy={s.y * 10} r={s.r} fill="#cbd5e1" opacity={s.o} />
      ))}

      {/* 轨道椭圆（每颗行星） */}
      {nodes.map((nd) => (
        <ellipse
          key={`orbit-${nd.id}`}
          cx={nd.cx}
          cy={cy}
          rx={nodeR + 9}
          ry={nodeR + 4.5}
          fill="none"
          stroke="rgba(148,163,184,0.22)"
          strokeWidth={1}
          transform={`rotate(-8 ${nd.cx} ${cy})`}
        />
      ))}

      {/* 路径链（虚线流动感） */}
      {nodes.slice(1).map((nd, i) => {
        const prev = nodes[i];
        return (
          <line
            key={`l-${i}`}
            x1={prev.cx + nodeR}
            y1={cy}
            x2={nd.cx - nodeR}
            y2={cy}
            stroke="rgba(212,165,116,0.55)"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        );
      })}

      {/* 行星节点 */}
      {nodes.map((nd) => {
        const p = mastery[nd.id];
        const isRoot = nd.i === 0;
        const base = color(p);
        return (
          <g key={nd.id}>
            {/* 光晕 */}
            <circle cx={nd.cx} cy={cy} r={nodeR + 5} fill={base} opacity={0.18} />
            {/* 行星体 */}
            <circle cx={nd.cx} cy={cy} r={nodeR} fill={base} stroke={isRoot ? amber : "rgba(148,163,184,0.6)"} strokeWidth={isRoot ? 2 : 1} />
            {/* 光照层（受光面亮） */}
            <circle cx={nd.cx} cy={cy} r={nodeR} fill="url(#planetGrad)" />
            {/* 根因呼吸脉冲环 */}
            {isRoot && <circle cx={nd.cx} cy={cy} r={nodeR + 4.5} fill="none" stroke={amber} strokeWidth={1.2} opacity={0.6} />}
            {/* 编号 */}
            <text x={nd.cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight={700}>
              {nd.id.replace(/[a-z]/g, "")}
            </text>
            <text x={nd.cx} y={cy + 30} textAnchor="middle" fontSize={9} fill="rgba(148,163,184,0.9)">
              {names?.[nd.id] || nd.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
