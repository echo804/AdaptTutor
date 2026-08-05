"use client";

import { useEffect, useState } from "react";
import { api, MasteryOut, PathOut } from "@/lib/api";

/** 仪表盘：掌握度快照 + 推荐路径（M4 验收：展示真实数据） */
export default function DashboardPage() {
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [path, setPath] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ user_id: number }>("/auth/me");
        const [m, p] = await Promise.all([
          api<MasteryOut>(`/api/v1/students/${me.user_id}/mastery`),
          api<PathOut>(`/api/v1/students/${me.user_id}/path`),
        ]);
        setMastery(m.mastery);
        setPath(p.path);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, []);

  const entries = Object.entries(mastery).sort((a, b) => a[1] - b[1]);
  const weakest = entries.slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">仪表盘</h1>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {/* 薄弱点 */}
        <div className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium">最薄弱知识点</h2>
          {weakest.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>还没有诊断数据，先去对话页做一次诊断。</p>}
          <div className="space-y-2">
            {weakest.map(([nid, p]) => (
              <div key={nid}>
                <div className="mb-1 flex justify-between text-xs" style={{ color: "var(--muted)" }}>
                  <span>{nid}</span>
                  <span>{Math.round(p * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
                  <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: "var(--accent)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 推荐路径 */}
        <div className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-sm font-medium">推荐学习路径</h2>
          {path.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>诊断后将生成路径。</p>}
          <ol className="space-y-1 text-sm">
            {path.map((nid, i) => (
              <li key={nid} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-xs text-white" style={{ background: "var(--accent)" }}>
                  {i + 1}
                </span>
                <span>{nid}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* 全部掌握度 */}
      <div className="rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <h2 className="mb-3 text-sm font-medium">全部节点掌握度</h2>
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {entries.map(([nid, p]) => (
            <div key={nid} className="flex items-center gap-2 text-xs">
              <span className="w-10 shrink-0" style={{ color: "var(--muted)" }}>{nid}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
                <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: p < 0.5 ? "#c0392b" : "var(--accent)" }} />
              </div>
              <span className="w-10 shrink-0 text-right">{Math.round(p * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
