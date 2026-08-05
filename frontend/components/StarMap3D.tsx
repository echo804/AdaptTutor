"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";

/** 3D 宇宙星辰图（M4r6 需求 3）：
 * - 星系螺旋布局 + 中央恒星 + 星云粒子背景
 * - 行星节点：掌握度点亮（琥珀发光）/ 未完成暗沉冷灰
 * - 高级交互：OrbitControls 拖拽/旋转/缩放、hover 放大发光、点击信息卡
 * - 溯源：暖色发光路径 + 根因脉冲
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

// 05 配色
const AMBER = new THREE.Color("#d4a574");
const COLD = new THREE.Color("#94a3b8");
const WARM_GREEN = new THREE.Color("#7ec8a0");

function lerpColor(c1: THREE.Color, c2: THREE.Color, t: number) {
  return c1.clone().lerp(c2, Math.max(0, Math.min(1, t)));
}

// 星系螺旋布局：阿基米德螺旋 + z 波动
function spiralPositions(nodes: StarNode[]) {
  const pos: Record<string, [number, number, number]> = {};
  nodes.forEach((n, i) => {
    const theta = 0.8 + i * 0.55;
    const r = 5.5 + theta * 0.45;
    pos[n.id] = [r * Math.cos(theta), (i % 5) * 0.9 - 1.8, r * Math.sin(theta) * 0.55];
  });
  return pos;
}

function Planet({
  id,
  name,
  mastery,
  lit,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  id: string;
  name: string;
  mastery: number | undefined;
  lit: boolean;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useFrame(({ clock }) => {
    const t = reduce ? 0 : clock.getElapsedTime();
    if (meshRef.current) {
      const s = hovered ? 1.45 : selected ? 1.25 : 1;
      meshRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.15);
      meshRef.current.rotation.y += reduce ? 0 : 0.004;
    }
    if (lightRef.current && lit) {
      lightRef.current.intensity = 1.2 + (reduce ? 0 : 0.5 * Math.sin(t * 2 + (id.charCodeAt(1) || 0)));
    }
  });

  // 掌握度色：点亮 → 琥珀→暖绿（按掌握度）；未点亮 → 冷灰暗沉
  const color = lit
    ? lerpColor(AMBER, WARM_GREEN, Math.max(0, Math.min(1, ((mastery ?? 0) - 0.5) / 0.4)))
    : COLD.clone().multiplyScalar(0.6);
  const emissive = lit ? new THREE.Color("#d4a574") : new THREE.Color("#000000");

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
        <sphereGeometry args={[lit ? 0.55 : 0.42, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={lit ? 0.7 : 0.12}
          roughness={lit ? 0.35 : 0.8}
        />
      </mesh>
      {/* 点亮光晕 */}
      {lit && <pointLight ref={lightRef} color="#d4a574" distance={6} intensity={1.2} />}
      {/* 选中/悬停外环 */}
      {(selected || hovered) && (
        <mesh>
          <sphereGeometry args={[0.85, 16, 16]} />
          <meshBasicMaterial color="#d4a574" wireframe transparent opacity={0.55} />
        </mesh>
      )}
      {/* 名称标签 */}
      <Html position={[0, 1.1, 0]} center distanceFactor={10} zIndexRange={[20, 0]}>
        <div
          className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]"
          style={{
            background: lit ? "rgba(212,165,116,0.15)" : "rgba(15,23,42,0.6)",
            color: lit ? "#e8e6e3" : "rgba(148,163,184,0.85)",
            border: selected ? "1px solid #d4a574" : "1px solid transparent",
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

function Galaxy({ nodes, edges, mastery, selected, onSelect, litThreshold, traceChain, traceRoot, positions }: {
  nodes: StarNode[];
  edges: StarEdge[];
  mastery: Record<string, number>;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  litThreshold: number;
  traceChain: string[];
  traceRoot?: string;
  positions: Record<string, [number, number, number]>;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<THREE.Mesh>(null);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useFrame(({ clock }) => {
    const t = reduce ? 0 : clock.getElapsedTime();
    if (rootRef.current) {
      // 根因呼吸脉冲
      const s = 1 + (reduce ? 0 : 0.18 * Math.sin(t * 2.4));
      rootRef.current.scale.set(s, s, s);
    }
  });

  // 边：暗色细线；溯源暖色发光（glow 用二次线段）
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
      {/* 边 */}
      {edgeLines.map((l) => (
        <line key={l.key}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array([...l.from, ...l.to]), 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={l.traced ? "#d4a574" : "#475569"}
            transparent
            opacity={l.traced ? 0.85 : 0.35}
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
              mastery={p}
              lit={lit}
              selected={selected === n.id}
              hovered={hovered === n.id}
              onHover={setHovered}
              onSelect={(id) => onSelect?.(id)}
            />
          </group>
        );
      })}

      {/* 根因呼吸脉冲环 */}
      {traceRoot && positions[traceRoot] && (
        <mesh ref={rootRef} position={positions[traceRoot]}>
          <sphereGeometry args={[1.1, 20, 20]} />
          <meshBasicMaterial color="#d4a574" wireframe transparent opacity={0.45} />
        </mesh>
      )}
    </group>
  );
}

export default function StarMap3D(props: StarMap3DProps) {
  const { nodes, edges, mastery, selected, onSelect, litThreshold = 0.5, traceChain = [], traceRoot } = props;
  const positions = useMemo(() => spiralPositions(nodes), [nodes]);
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div className="h-full w-full" style={{ background: "radial-gradient(ellipse at 30% 30%, #0f172a 0%, #0b1120 60%, #060a14 100%)" }}>
      <Canvas camera={{ position: [14, 6, 14], fov: 50 }} dpr={[1, 1.5]}>
        <ambientLight intensity={0.35} />
        <pointLight position={[0, 0, 0]} intensity={0.8} color="#d4a574" />
        <Stars radius={80} depth={40} count={2600} factor={3.2} saturation={0} fade speed={reduce ? 0 : 0.6} />

        {/* 中央恒星 */}
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[1.35, 32, 32]} />
          <meshStandardMaterial color="#d4a574" emissive="#d4a574" emissiveIntensity={0.9} roughness={0.2} />
        </mesh>
        <pointLight position={[0, 0, 0]} color="#d4a574" intensity={2.2} distance={40} />

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
        />

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          enablePan={false}
          minDistance={6}
          maxDistance={40}
          rotateSpeed={0.7}
          autoRotate={!reduce}
          autoRotateSpeed={0.5}
        />
      </Canvas>
    </div>
  );
}
