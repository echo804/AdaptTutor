"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

/** 领域学习空间（M4r8）：包列表 + 当前激活领域，全局共享。 */

export interface DomainInfo {
  id: string;
  subject: string;
  version: string;
}

interface DomainContextValue {
  packs: DomainInfo[];
  active: string | null; // 激活领域 id（null=加载中/未登录）
  ready: boolean;
  loading: boolean;
  setActive: (packId: string) => Promise<void>;
}

const DomainContext = createContext<DomainContextValue>({
  packs: [],
  active: null,
  ready: false,
  loading: true,
  setActive: async () => {},
});

const ACTIVE_KEY = "at_active_pack";

export function DomainProvider({ children }: { children: React.ReactNode }) {
  const [packs, setPacks] = useState<DomainInfo[]>([]);
  const [active, setActiveState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  // 加载包列表 + 激活领域（服务端权威；localStorage 作为乐观缓存）。
  // 依赖 pathname：登录页（未认证）fetch 401 失败后，跳转登录成功时重新加载。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = localStorage.getItem(ACTIVE_KEY);
        if (cached && !cancelled) setActiveState(cached);
        const data = await api<{ packs: DomainInfo[]; active: string }>("/api/v1/domains");
        if (cancelled) return;
        setPacks(data.packs || []);
        setActiveState(data.active);
        localStorage.setItem(ACTIVE_KEY, data.active);
      } catch {
        /* 未登录/网络异常：保持缓存值 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const setActive = useCallback(async (packId: string) => {
    setActiveState(packId);
    localStorage.setItem(ACTIVE_KEY, packId);
    try {
      const data = await api<{ active: string }>("/api/v1/me/active-pack", {
        method: "PUT",
        body: { pack_id: packId },
      });
      setActiveState(data.active);
      localStorage.setItem(ACTIVE_KEY, data.active);
    } catch {
      /* 服务端同步失败：保留本地选择，下次加载修正 */
    }
  }, []);

  return (
    <DomainContext.Provider
      value={{ packs, active, ready: !loading, loading, setActive }}
    >
      {children}
    </DomainContext.Provider>
  );
}

export function useDomain() {
  return useContext(DomainContext);
}
