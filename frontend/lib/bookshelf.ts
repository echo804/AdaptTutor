"use client";

import { api, MasteryOut } from "@/lib/api";

/** 书架数据层（M4r11）：采集所有领域包的节点数 + 掌握度，供魔法书架展示。
 * 后端无聚合接口 → 前端组合 /domains + 每领域 graph + mastery（pack 数量少，并发可接受）。
 */

export interface BookInfo {
  id: string;        // pack_id
  subject: string;   // 领域名（书脊书名）
  version: string;
  total: number;     // 知识点总数
  mastered: number;  // 已点亮节点数
  percent: number;   // 掌握度 0~1（星群用）
}

// 点亮阈值：与星辰图 litThreshold 保持一致（graph/page.tsx 默认 0.5）
const LIT_THRESHOLD = 0.5;

// 简单缓存（60s），避免书架/展开反复拉取
let cache: { books: BookInfo[]; at: number } | null = null;
const TTL = 60_000;

export async function loadBookshelf(force = false): Promise<BookInfo[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.books;

  const [domains, me] = await Promise.all([
    api<{ packs: { id: string; subject: string; version: string }[] }>("/api/v1/domains"),
    api<{ user_id: number }>("/auth/me"),
  ]);
  const packs = domains.packs || [];
  if (packs.length === 0) {
    cache = { books: [], at: Date.now() };
    return [];
  }

  // 每领域并发：graph（节点总数）+ mastery（已点亮数）
  const books = await Promise.all(
    packs.map(async (p) => {
      let total = 0;
      let mastered = 0;
      try {
        const g = await api<{ nodes: unknown[] }>(`/api/v1/graph?pack_id=${encodeURIComponent(p.id)}`);
        total = (g.nodes || []).length;
        const m = await api<MasteryOut>(`/api/v1/students/${me.user_id}/mastery?pack_id=${encodeURIComponent(p.id)}`).catch(
          () => ({ mastery: {}, weakest: null } as MasteryOut),
        );
        mastered = Object.values(m.mastery || {}).filter((v) => v >= LIT_THRESHOLD).length;
      } catch {
        /* 单个领域拉取失败：按 0 节点处理，书架仍显示 */
      }
      return {
        id: p.id,
        subject: p.subject,
        version: p.version,
        total,
        mastered,
        percent: total > 0 ? mastered / total : 0,
      };
    }),
  );

  cache = { books, at: Date.now() };
  return books;
}
