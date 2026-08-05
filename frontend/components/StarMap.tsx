"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** 星辰图（M4r2，对齐 05 §7"像一颗星星被点亮"）。
 *
 * - 深蓝夜空背景 + 星点粒子（微闪）
 * - 知识星：掌握度 ≥ 阈值 → 点亮（琥珀光晕 + 脉冲）；未完成 → 暗沉冷灰
 * - 掌握度色阶：冷灰 #94A3B8 → 暖绿 #7EC8A0（05 §2.4）
 * - 点击星 → onSelect（详情卡）；prefers-reduced-motion 时静态
 */

export interface StarNode {
  id: string;
  name: string;
  difficulty: number;
  importance: number;
}
export interface StarEdge {
  from: string;
  to: string;
}

interface StarMapProps {
  nodes: StarNode[];
  edges: StarEdge[];
  mastery: Record<string, number>;
  selected?: string | null;
  onSelect?: (nodeId: string | null) => void;
  litThreshold?: number; // 掌握度 ≥ 阈值视为点亮
  traceChain?: string[]; // 溯源祖先链（暖色发光路径，05 §5.2）
  traceRoot?: string;    // 根因（呼吸脉冲）
}

// 05 配色
const NIGHT = ["#0b1120", "#0f172a", "#1e293b"];
const COLD_GRAY = "#94a3b8";
const WARM_GREEN = "#7ec8a0";
const AMBER = "#d4a574";
const EDGE = "rgba(148,163,184,0.22)";

function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number) {
  const ch = (i: number) => Math.round(c1[i] + (c2[i] - c1[i]) * t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

export default function StarMap({ nodes, edges, mastery, selected, onSelect, litThreshold = 0.5, traceChain = [], traceRoot }: StarMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);

  // 布局：按 id 前缀分模块列，列内垂直分布
  const layout = useMemo(() => {
    const cols: Record<string, { x: number; items: string[] }> = {};
    nodes.forEach((n) => {
      const prefix = n.id.replace(/[0-9]/g, "");
      cols[prefix] = cols[prefix] || { x: 0, items: [] };
      cols[prefix].items.push(n.id);
    });
    const keys = Object.keys(cols);
    const pos: Record<string, { x: number; y: number }> = {};
    keys.forEach((k, ci) => {
      cols[k].items.forEach((nid, ri) => {
        pos[nid] = { x: 0.1 + (ci + 0.5) * (0.8 / Math.max(keys.length, 1)), y: 0.12 + (ri + 0.5) * (0.76 / Math.max(cols[k].items.length, 1)) };
      });
    });
    return pos;
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d")!; // 非空断言（上方已校验）
    const cv: HTMLCanvasElement = canvas; // 闭包非空捕获

    let raf = 0;
    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // 星空粒子
    const stars = Array.from({ length: 90 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.2 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
    }));

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();

    function resize() {
      const rect = wrapRef.current!.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function nodeById(nid: string) {
      return nodes.find((n) => n.id === nid);
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));

    function draw(t: number) {
      // 背景渐变
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, NIGHT[0]);
      g.addColorStop(0.6, NIGHT[1]);
      g.addColorStop(1, NIGHT[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // 星点粒子（微闪）
      const tw = reduceMotion ? 0.7 : (Math.sin(t / 600) + 1) / 2 * 0.6 + 0.4;
      for (const s of stars) {
        const alpha = reduceMotion ? 0.5 : 0.3 + 0.5 * Math.abs(Math.sin(t / 1400 + s.phase));
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(226,232,240,${(alpha * tw).toFixed(3)})`;
        ctx.fill();
      }

      // 边（暗色细线）
      ctx.lineWidth = 1;
      const chainSet = new Set(traceChain);
      for (const e of edges) {
        const a = layout[e.from];
        const b = layout[e.to];
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(a.x * W, a.y * H);
        ctx.lineTo(b.x * W, b.y * H);
        const traced = chainSet.has(e.from) && chainSet.has(e.to);
        if (traced) {
          // 溯源路径：暖色 + 虚线流动（05 §6 路径绘制，reduced-motion 时实线）
          ctx.strokeStyle = "rgba(212,165,116,0.75)";
          ctx.lineWidth = 1.8;
          if (reduceMotion) {
            ctx.setLineDash([]);
          } else {
            ctx.setLineDash([6, 4]);
            ctx.lineDashOffset = -((t / 40) % 10);
          }
        } else {
          ctx.strokeStyle = EDGE;
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
      }

      // 溯源根因（呼吸脉冲，05 §5.2）
      if (traceRoot && layout[traceRoot]) {
        const rp = layout[traceRoot];
        const rx = rp.x * W;
        const ry = rp.y * H;
        const breathe = reduceMotion ? 1 : 1 + 0.25 * Math.sin(t / 600);
        const ring = ctx.createRadialGradient(rx, ry, 6, rx, ry, 26 * breathe);
        ring.addColorStop(0, "rgba(212,165,116,0.8)");
        ring.addColorStop(1, "rgba(212,165,116,0)");
        ctx.beginPath();
        ctx.arc(rx, ry, 26 * breathe, 0, Math.PI * 2);
        ctx.fillStyle = ring;
        ctx.fill();
      }

      // 知识星
      for (const n of nodes) {
        const p = layout[n.id];
        const cx = p.x * W;
        const cy = p.y * H;
        const mp = mastery[n.id];
        const lit = mp !== undefined && mp >= litThreshold;
        const isSelected = selected === n.id;
        const isHover = hover === n.id;

        const pulse = reduceMotion ? 1 : 1 + 0.12 * Math.sin(t / 900 + (n.id.charCodeAt(1) || 0));

        if (lit) {
          // 点亮：琥珀光晕 + 脉冲
          const halo = 22 * pulse;
          const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, halo);
          grad.addColorStop(0, "rgba(212,165,116,0.55)");
          grad.addColorStop(1, "rgba(212,165,116,0)");
          ctx.beginPath();
          ctx.arc(cx, cy, halo, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
          // 中心色：掌握度冷灰→暖绿
          ctx.beginPath();
          ctx.arc(cx, cy, 11, 0, Math.PI * 2);
          ctx.fillStyle = lerpColor([148, 163, 184], [126, 200, 160], Math.max(0, Math.min(1, (mp - litThreshold) / 0.4)));
          ctx.fill();
        } else {
          // 未点亮：暗沉冷灰
          ctx.beginPath();
          ctx.arc(cx, cy, 9, 0, Math.PI * 2);
          ctx.fillStyle = mp === undefined ? "rgba(148,163,184,0.28)" : "rgba(148,163,184,0.45)";
          ctx.fill();
        }

        // 选中/悬停：外环
        if (isSelected || isHover) {
          ctx.beginPath();
          ctx.arc(cx, cy, 16, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(212,165,116,0.8)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // 节点名（小字）
        ctx.fillStyle = lit ? "rgba(232,230,225,0.95)" : "rgba(148,163,184,0.75)";
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(byId.get(n.id)?.name || n.id, cx, cy + 26);
      }
    }

    function loop(t: number) {
      draw(t);
      if (!reduceMotion) raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // 点击命中检测
    function onCanvasClick(e: MouseEvent) {
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / W;
      const my = (e.clientY - rect.top) / H;
      let hit: string | null = null;
      let best = 0.06;
      for (const n of nodes) {
        const p = layout[n.id];
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < best) {
          best = d;
          hit = n.id;
        }
      }
      onSelect?.(hit);
    }
    function onMove(e: MouseEvent) {
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / W;
      const my = (e.clientY - rect.top) / H;
      let hit: string | null = null;
      let best = 0.06;
      for (const n of nodes) {
        const p = layout[n.id];
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d < best) {
          best = d;
          hit = n.id;
        }
      }
      cv.style.cursor = hit ? "pointer" : "default";
      setHover(hit);
    }
    cv.addEventListener("click", onCanvasClick);
    cv.addEventListener("mousemove", onMove);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      cv.removeEventListener("click", onCanvasClick);
      cv.removeEventListener("mousemove", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, mastery, selected, hover, litThreshold, traceChain, traceRoot]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-xl">
      <canvas ref={canvasRef} />
    </div>
  );
}
