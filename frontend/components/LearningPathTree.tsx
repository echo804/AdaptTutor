"use client";

/** 学习路径树（M4r3，05 §5.3）：SVG 横向链——根因 → … → 目标，
 * 节点圆按掌握度着色（冷灰 #94A3B8 → 暖绿 #7EC8A0），链首根因暖色描边。 */

interface LearningPathTreeProps {
  path: string[];               // 推荐路径节点 id（拓扑序，链首=根因）
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

export default function LearningPathTree({ path, mastery, names, height = 120 }: LearningPathTreeProps) {
  const n = path.length;
  if (n === 0) return null;
  const padX = 34;
  const nodeR = 16;
  const step = n > 1 ? (100 - padX * 2) / (n - 1) : 0;
  const cy = height / 2;

  const nodes = path.map((id, i) => {
    const x = padX + (n > 1 ? i * step : 0);
    return { id, x, cx: (x / 100) * 1000, i };
  });

  return (
    <svg viewBox={`0 0 1000 ${height}`} className="w-full" role="img" aria-label="学习路径树">
      {/* 连线 */}
      {nodes.slice(1).map((nd, i) => {
        const prev = nodes[i];
        return (
          <line
            key={`l-${i}`}
            x1={prev.cx + nodeR}
            y1={cy}
            x2={nd.cx - nodeR}
            y2={cy}
            stroke="rgba(148,163,184,0.4)"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        );
      })}
      {/* 节点 */}
      {nodes.map((nd) => {
        const p = mastery[nd.id];
        const isRoot = nd.i === 0;
        return (
          <g key={nd.id}>
            <circle
              cx={nd.cx}
              cy={cy}
              r={nodeR}
              fill={color(p)}
              stroke={isRoot ? "#d4a574" : "rgba(148,163,184,0.5)"}
              strokeWidth={isRoot ? 2 : 1}
            />
            {/* 根因脉冲环 */}
            {isRoot && <circle cx={nd.cx} cy={cy} r={nodeR + 4} fill="none" stroke="#d4a574" strokeWidth={1} opacity={0.5} />}
            <text x={nd.cx} y={cy + 4} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight={600}>
              {nd.id.replace(/[a-z]/g, "")}
            </text>
            <text x={nd.cx} y={cy + 26} textAnchor="middle" fontSize={9} fill="rgba(148,163,184,0.9)">
              {names?.[nd.id] || nd.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
