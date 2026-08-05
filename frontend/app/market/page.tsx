"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useDomain } from "@/lib/domain";

/** 领域市场（M4r8e）：浏览所有已审核公开的用户领域，一键切换学习。 */

interface MarketItem {
  id: number;
  pack_id: string;
  name: string;
  description: string | null;
  username: string;
  nodes_count: number | null;
  questions_count: number | null;
  created_at: string | null;
  owner: boolean;
}

export default function MarketPage() {
  const [items, setItems] = useState<MarketItem[]>([]);
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const { active, setActive } = useDomain();
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ items: MarketItem[] }>("/api/v1/market/domains");
        setItems(r.items || []);
      } catch (e: any) {
        setErr(e.message);
      }
    })();
  }, []);

  const filtered = items.filter(
    (d) =>
      !query.trim() ||
      d.name.includes(query.trim()) ||
      (d.description || "").includes(query.trim()) ||
      d.username.includes(query.trim()),
  );

  async function start(d: MarketItem) {
    try {
      await setActive(d.pack_id);
      router.push("/chat");
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          领域市场
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          浏览用户共享的公开领域，点击即可切换学习
        </p>
      </div>

      <input
        placeholder="搜索领域 / 作者…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
      />

      {err && <div className="mb-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>{err}</div>}

      {filtered.length === 0 && (
        <div className="rounded-xl border p-10 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          {query ? "没有匹配的领域" : "还没有公开领域——在「我的领域」创建并发布为公开，审核通过后就会出现在这里 ✨"}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {filtered.map((d) => {
          const active0 = active === d.pack_id;
          return (
            <div key={d.id} className="flex flex-col rounded-xl border p-4" style={{ background: "var(--surface)", borderColor: active0 ? "var(--accent)" : "var(--border)" }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{d.name}</span>
                {d.owner && (
                  <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    我的
                  </span>
                )}
                {active0 && (
                  <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#7ec8a022", color: "#7ec8a0" }}>
                    学习中
                  </span>
                )}
              </div>
              {d.description && <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{d.description}</p>}
              <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                by {d.username} · {d.nodes_count ?? "?"} 知识点 · {d.questions_count ?? "?"} 题
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ background: "var(--accent)", color: "#fff" }}
                  onClick={() => start(d)}
                >
                  {active0 ? "继续学习 →" : "开始学习 →"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
