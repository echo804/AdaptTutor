/** API 客户端（前端唯一访问后端的通道）。
 * 8000 被上级项目占用（同 5432），AdaptTutor 后端固定 8010。
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8010";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("at_token");
}

export function setToken(token: string): void {
  localStorage.setItem("at_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("at_token");
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const { method = "GET", body, token } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = token !== undefined ? token : getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    try {
      const data = await res.json();
      if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- 类型 ----

export interface AuthResponse {
  token: string;
  user_id: number;
  username: string;
}

export interface KeyItem {
  provider: string;
  masked_key: string;
}

export interface Question {
  id: string;
  type: "choice" | "blank" | "open";
  content: string;
  options?: string[];
  difficulty: number;
}

export interface MessageReply {
  state: string;
  message: string;
  degraded: boolean;
  mock: boolean;
  question: Question | null;
  terminated: boolean;
  done: boolean;
}

export interface SessionCreated {
  session_id: number;
  type: string;
  status: string;
  first_message: string | null;
  question: Question | null;
}

export interface MasteryOut {
  mastery: Record<string, number>;
  weakest: string | null;
}

export interface PathOut {
  path: string[];
}

export interface TraceOut {
  wrong_node: string;
  root: string;
  chain: string[];
}

export interface MessageOut {
  id: number;
  role: string;
  content: string;
  trace_id: string;
  created_at: string;
}
