"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import { hexToRgba, useThemeVar } from "@/lib/theme";

/** 3D 宇宙星辰图（M4r8c 重构）：
 * - 聚类星系星团布局：按关联度（主题前缀）划分多个独立子星团，
 *   各星团环绕中心月牙均匀分布；星团内部小型放射排列；
 *   力导向迭代防节点重叠，关联越强的节点越靠近星团内侧/中心
 * - 中央主节点：月牙样式（新月 Shape），暖色发光
 * - 视觉：简约科技星空——浅白圆点节点、纤细浅色标签、细淡连接线
 * - 交互：OrbitControls 拖拽/缩放、hover 放大、点击信息卡、溯源暖色路径 + 根因脉冲
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

interface StarMap3DProps {
  nodes: StarNode[];
  edges: StarEdge[];
  mastery: Record<string, number>;
  selected?: string | null;
  onSelect?: (nodeId: string | null) => void;
  litThreshold?: number;
  traceChain?: string[];
  traceRoot?: string;
}

// 05 配色（语义色不随色板；强调色由主题变量动态传入）
const COLD = new THREE.Color("#94a3b8");
const WHITE = new THREE.Color("#e8e6e3");

function lerpColor(c1: THREE.Color, c2: THREE.Color, t: number) {
  return c1.clone().lerp(c2, Math.max(0, Math.min(1, t)));
}

/** 聚类星系布局（M4r8c）：
 * 1. 按 id 前缀聚类（主题 = 关联度簇）
 * 2. 各簇中心均匀环绕中心（xz 平面大圆）
 * 3. 簇内按关联度（度数 + importance）排序，强关联放内侧，初始小型放射
 * 4. 力导向迭代（同簇强排斥/跨簇弱排斥 + 簇心引力）防节点重叠
 */
function clusterLayout(nodes: StarNode[], edges: StarEdge[]) {
  const out: Record<string, [number, number, number]> = {};
  if (nodes.length === 0) return out;

  // 1) 聚类
  const groups: Record<string, StarNode[]> = {};
  nodes.forEach((n) => {
    const p = n.id.replace(/[0-9]/g, "") || "x";
    (groups[p] = groups[p] || []).push(n);
  });
  const keys = Object.keys(groups);
  const N = keys.length;

  // 2) 簇中心均匀环绕（xz 平面，半径 9.5）
  const CLUSTER_R = 9.5;
  const centers: Record<string, THREE.Vector3> = {};
  keys.forEach((k, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    centers[k] = new THREE.Vector3(Math.cos(a) * CLUSTER_R, 0, Math.sin(a) * CLUSTER_R);
  });

  // 3) 关联度：importance + 边数加权
  const degree: Record<string, number> = {};
  nodes.forEach((n) => (degree[n.id] = n.importance));
  edges.forEach((e) => {
    if (degree[e.from] !== undefined) degree[e.from] += 0.4;
    if (degree[e.to] !== undefined) degree[e.to] += 0.4;
  });

  // 4) 初始位置：簇内放射（强关联靠内）
  const prefixOf = (id: string) => id.replace(/[0-9]/g, "") || "x";
  const pos: Record<string, THREE.Vector3> = {};
  keys.forEach((k) => {
    const g = [...groups[k]].sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
    const c = centers[k];
    g.forEach((n, i) => {
      const t = g.length > 1 ? i / (g.length - 1) : 0;
      const ang = t * Math.PI * 2 * 0.92;
      const r = 1.3 + t * 4.2; // 排名靠前（强关联）→ 内侧
      pos[n.id] = new THREE.Vector3(
        c.x + Math.cos(ang) * r,
        (i % 4) * 0.6 - 0.9,
        c.z + Math.sin(ang) * r
      );
    });
  });

  // 5) 力导向迭代（同簇强排斥 / 跨簇弱排斥 + 簇心引力）
  const ids = Object.keys(pos);
  const MIN_D = 2.0;
  const ITERS = 110;
  for (let it = 0; it < ITERS; it++) {
    const damp = 1 - it / ITERS;
    const fx: Record<string, number> = {}, fy: Record<string, number> = {}, fz: Record<string, number> = {};
    ids.forEach((id) => ((fx[id] = 0), (fy[id] = 0), (fz[id] = 0)));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.001) continue;
        const d = Math.sqrt(d2);
        const same = prefixOf(ids[i]) === prefixOf(ids[j]);
        const f = (same ? 1.0 : 0.35) * Math.min(1, (MIN_D * MIN_D) / d2);
        const ux = dx / d, uy = dy / d, uz = dz / d;
        fx[ids[i]] += ux * f; fy[ids[i]] += uy * f; fz[ids[i]] += uz * f;
        fx[ids[j]] -= ux * f; fy[ids[j]] -= uy * f; fz[ids[j]] -= uz * f;
      }
    }
    ids.forEach((id) => {
      const c = centers[prefixOf(id)];
      fx[id] += (c.x - pos[id].x) * 0.02;
      fy[id] += (0 - pos[id].y) * 0.05;
      fz[id] += (c.z - pos[id].z) * 0.02;
    });
    ids.forEach((id) => {
      const len = Math.hypot(fx[id], fy[id], fz[id]);
      const step = Math.min(len, 0.14 * damp + 0.01);
      if (len > 0) {
        pos[id].x += (fx[id] / len) * step;
        pos[id].y += (fy[id] / len) * step;
        pos[id].z += (fz[id] / len) * step;
      }
    });
  }

  ids.forEach((id) => (out[id] = [pos[id].x, pos[id].y, pos[id].z]));
  return out;
}

/** 中央主节点：粒子旋涡星系（银河系质感——大量微粒子构成螺旋旋臂 + 中心核球，缓慢自转） */
function GalaxyCore({ amberHex }: { amberHex: string }) {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const groupRef = useRef<THREE.Group>(null);

  // 粒子数据：核球 + 两条螺旋旋臂 + 盘面散布（vertex colors 控制亮度）
  const particles = useMemo(() => {
    const amber = new THREE.Color(amberHex);
    const warm = new THREE.Color("#f0e2c8");
    const count = 5200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tmp = new THREE.Color();

    // 伪随机（可复现）
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2; // 近似正态

    const MAX_R = 6.2;
    const put = (i: number, x: number, y: number, z: number, c: THREE.Color, a = 1) => {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      colors[i * 3] = c.r * a;
      colors[i * 3 + 1] = c.g * a;
      colors[i * 3 + 2] = c.b * a;
    };

    let idx = 0;
    // 1) 中心核球（bulge）：球状密集，亮
    const bulgeN = 1200;
    for (let i = 0; i < bulgeN; i++, idx++) {
      const r = Math.pow(rand(), 0.5) * 1.5;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      put(idx, r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th),
        tmp.copy(warm).lerp(amber, rand()), 0.85 + rand() * 0.15);
    }
    // 2) 两条螺旋旋臂（对数螺旋 + 宽度抖动，越外越散）
    const ARM = 2;
    const armN = 3000;
    for (let i = 0; i < armN; i++, idx++) {
      const a = i % ARM;
      const t = rand() ** 0.75; // 内密外疏
      const r = 0.4 + t * MAX_R;
      const theta = t * Math.PI * 2.2 + a * Math.PI + gauss() * 0.12;
      const spread = 0.18 + t * 0.55; // 越外越散
      const x = Math.cos(theta) * r + gauss() * spread;
      const z = Math.sin(theta) * r + gauss() * spread;
      const y = gauss() * (0.06 + t * 0.12);
      // 亮度：中心亮、外缘暗（银河盘面渐变）
      const fade = Math.max(0, 1 - t * 0.85);
      put(idx, x, y, z, tmp.copy(amber).lerp(new THREE.Color("#e8e6e3"), 0.25), 0.3 + fade * 0.65);
    }
    // 3) 盘面稀疏散布（背景微尘）
    const dustN = 1000;
    for (let i = 0; i < dustN; i++, idx++) {
      const r = 1.2 + rand() * MAX_R * 0.9;
      const th = rand() * Math.PI * 2;
      put(idx, Math.cos(th) * r, gauss() * 0.15, Math.sin(th) * r,
        tmp.copy(amber), 0.12 + rand() * 0.15);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [amberHex]);

  // 缓慢自转（银河系旋转）
  useFrame(({ clock }) => {
    if (groupRef.current && !reduce) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.08;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* 粒子星系（点云） */}
      <group ref={groupRef}>
        <points geometry={particles}>
          <pointsMaterial
            size={0.09}
            vertexColors
            transparent
            opacity={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            sizeAttenuation
          />
        </points>
      </group>
      {/* 中心亮核（微光球 + 柔和光晕） */}
      <mesh>
        <sphereGeometry args={[0.42, 20, 20]} />
        <meshBasicMaterial color={amberHex} transparent opacity={0.85} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.1, 20, 20]} />
        <meshBasicMaterial color={amberHex} transparent opacity={0.1} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.8, 20, 20]} />
        <meshBasicMaterial color={amberHex} transparent opacity={0.04} />
      </mesh>
      <pointLight color={amberHex} intensity={2.0} distance={32} />
    </group>
  );
}

function Planet({
  id,
  name,
  lit,
  selected,
  hovered,
  onHover,
  onSelect,
  amberHex,
}: {
  id: string;
  name: string;
  lit: boolean;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  amberHex: string;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useFrame(({ clock }) => {
    const t = reduce ? 0 : clock.getElapsedTime();
    if (meshRef.current) {
      const s = hovered ? 1.5 : selected ? 1.3 : 1;
      meshRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.15);
    }
    if (lightRef.current && lit) {
      lightRef.current.intensity = 0.5 + (reduce ? 0 : 0.2 * Math.sin(t * 2 + (id.charCodeAt(1) || 0)));
    }
  });

  // 简约科技风：浅白圆点——点亮 = 白色微暖发光；未点亮 = 灰白暗淡
  const color = lit ? WHITE : COLD.clone().multiplyScalar(0.55);
  const emissive = lit ? lerpColor(WHITE, new THREE.Color(amberHex), 0.2) : new THREE.Color("#0a0f1e");

  return (
    <group>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "default";
        }}
      >
        <sphereGeometry args={[lit ? 0.5 : 0.38, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={lit ? 0.65 : 0.1}
          roughness={0.5}
        />
      </mesh>
      {lit && <pointLight ref={lightRef} color={amberHex} distance={4} intensity={0.5} />}
      {/* 选中/悬停外环（细线） */}
      {(selected || hovered) && (
        <mesh>
          <sphereGeometry args={[0.68, 16, 16]} />
          <meshBasicMaterial color={amberHex} wireframe transparent opacity={0.5} />
        </mesh>
      )}
      {/* 纤细浅色标签 */}
      <Html position={[0, 1.0, 0]} center distanceFactor={10} zIndexRange={[20, 0]}>
        <div
          className="whitespace-nowrap px-1 py-0.5 text-[10px]"
          style={{
            background: "rgba(10,15,30,0.38)",
            color: lit ? "rgba(236,240,247,0.88)" : "rgba(148,163,184,0.7)",
            fontWeight: 300,
            letterSpacing: "0.02em",
            borderRadius: 2,
            backdropFilter: "blur(2px)",
            userSelect: "none",
          }}
        >
          {name}
        </div>
      </Html>
    </group>
  );
}

function Galaxy({ nodes, edges, mastery, selected, onSelect, litThreshold, traceChain, traceRoot, positions, amberHex }: {
  nodes: StarNode[];
  edges: StarEdge[];
  mastery: Record<string, number>;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  litThreshold: number;
  traceChain: string[];
  traceRoot?: string;
  positions: Record<string, [number, number, number]>;
  amberHex: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<THREE.Mesh>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useFrame(({ clock }) => {
    const t = reduce ? 0 : clock.getElapsedTime();
    if (rootRef.current) {
      const s = 1 + (reduce ? 0 : 0.18 * Math.sin(t * 2.4));
      rootRef.current.scale.set(s, s, s);
    }
  });

  // 边：细淡浅色；溯源暖色
  const edgeLines = useMemo(() => {
    const lines: { key: string; from: [number, number, number]; to: [number, number, number]; traced: boolean }[] = [];
    for (const e of edges) {
      const a = positions[e.from];
      const b = positions[e.to];
      if (!a || !b) continue;
      lines.push({
        key: `${e.from}-${e.to}`,
        from: a,
        to: b,
        traced: traceChain.includes(e.from) && traceChain.includes(e.to),
      });
    }
    return lines;
  }, [edges, positions, traceChain]);

  return (
    <group>
      {/* 边：细淡 */}
      {edgeLines.map((l) => (
        <line key={l.key}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([...l.from, ...l.to]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={l.traced ? amberHex : "#64748b"}
            transparent
            opacity={l.traced ? 0.7 : 0.16}
          />
        </line>
      ))}

      {/* 行星节点 */}
      {nodes.map((n) => {
        const p = mastery[n.id];
        const lit = p !== undefined && p >= litThreshold;
        return (
          <group key={n.id} position={positions[n.id]}>
            <Planet
              id={n.id}
              name={n.name || n.id}
              lit={lit}
              selected={selected === n.id}
              hovered={hovered === n.id}
              onHover={setHovered}
              onSelect={(id) => onSelect?.(id)}
              amberHex={amberHex}
            />
          </group>
        );
      })}

      {/* 根因呼吸脉冲环 */}
      {traceRoot && positions[traceRoot] && (
        <mesh ref={rootRef} position={positions[traceRoot]}>
          <sphereGeometry args={[0.9, 20, 20]} />
          <meshBasicMaterial color={amberHex} wireframe transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  );
}

/** 强制同步 canvas 尺寸 = 容器 offset 尺寸（R3F 初始测量偏差的兜底）。
 * 用 offsetWidth/Height（不受 star-reveal 动画 scale transform 影响）。 */
function ResizeSync() {
  const setSize = useThree((s) => s.setSize);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const sync = () => setSize(parent.offsetWidth, parent.offsetHeight);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(parent);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [gl, setSize]);
  return null;
}

export default function StarMap3D(props: StarMap3DProps) {
  const { nodes, edges, mastery, selected, onSelect, litThreshold = 0.5, traceChain = [], traceRoot } = props;
  const positions = useMemo(() => clusterLayout(nodes, edges), [nodes, edges]);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const amberHex = useThemeVar("--amber", "#d4a574");

  return (
    <div className="h-full w-full" style={{ background: "radial-gradient(ellipse at 30% 30%, #0f172a 0%, #0b1120 60%, #060a14 100%)" }}>
      <Canvas
        camera={{ position: [0, 14, 16], fov: 50 }}
        dpr={[1, 1.5]}
      >
        {/* 强制同步 canvas 尺寸 = 容器 offset 尺寸（R3F 初始测量偏差的兜底） */}
        <ResizeSync />
        <ambientLight intensity={0.4} />
        <pointLight position={[0, 4, 0]} intensity={0.6} color="#e8e6e3" />
        <Stars radius={80} depth={40} count={2600} factor={3.2} saturation={0} fade speed={reduce ? 0 : 0.6} />

        {/* 中央旋涡星系主节点 */}
        <GalaxyCore amberHex={amberHex} />

        <Galaxy
          nodes={nodes}
          edges={edges}
          mastery={mastery}
          selected={selected}
          onSelect={onSelect}
          litThreshold={litThreshold}
          traceChain={traceChain}
          traceRoot={traceRoot}
          positions={positions}
          amberHex={amberHex}
        />

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          enablePan={false}
          minDistance={8}
          maxDistance={40}
          rotateSpeed={0.7}
          autoRotate={false}
          autoRotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
}
