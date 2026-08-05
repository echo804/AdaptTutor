"use client";

import { useEffect, useState } from "react";

/** 主题应用/持久化（配合 globals.css 的 data-mode / data-accent 变量矩阵）。 */
export type ThemeMode = "auto" | "light" | "dark";
export type ThemeAccent = "ink" | "violet" | "forest" | "ocean" | "sunset";

export const ACCENTS: { id: ThemeAccent; label: string; light: string; dark: string }[] = [
  { id: "ink", label: "墨蓝", light: "#2c3e50", dark: "#d4a574" },
  { id: "violet", label: "星夜紫", light: "#6c5ce7", dark: "#a29bfe" },
  { id: "forest", label: "森绿", light: "#2e6b4f", dark: "#7fbfa0" },
  { id: "ocean", label: "海洋蓝", light: "#1e6091", dark: "#7fb3d9" },
  { id: "sunset", label: "落日橙", light: "#c05b2e", dark: "#e8956a" },
];

export const MODES: { id: ThemeMode; label: string }[] = [
  { id: "auto", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
];

const MODE_KEY = "at_mode";
const ACCENT_KEY = "at_accent";

/** 应用主题到 <html>（data-mode / data-accent），并广播事件供 Canvas/图表组件刷新。 */
export function applyTheme(mode: ThemeMode, accent: ThemeAccent) {
  const root = document.documentElement;
  if (mode === "auto") delete root.dataset.mode;
  else root.dataset.mode = mode;
  if (accent === "ink") delete root.dataset.accent;
  else root.dataset.accent = accent;
  window.dispatchEvent(new Event("at-theme-change"));
}

export function loadThemePrefs(): { mode: ThemeMode; accent: ThemeAccent } {
  try {
    const m = localStorage.getItem(MODE_KEY);
    const a = localStorage.getItem(ACCENT_KEY);
    return {
      mode: (m === "light" || m === "dark" ? m : "auto") as ThemeMode,
      accent: (["violet", "forest", "ocean", "sunset"].includes(a ?? "") ? a : "ink") as ThemeAccent,
    };
  } catch {
    return { mode: "auto", accent: "ink" };
  }
}

export function saveThemePrefs(mode: ThemeMode, accent: ThemeAccent) {
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 读取一个 CSS 变量值（供 Canvas/Three 等非 CSS 场景用），主题切换时自动刷新。 */
export function useThemeVar(name: string, fallback: string): string {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) setValue(v);
    };
    read();
    window.addEventListener("at-theme-change", read);
    return () => window.removeEventListener("at-theme-change", read);
  }, [name]);
  return value;
}

/** 将 #rrggbb / #rgb 转成 rgba() 字符串（图表/Canvas 用半透明强调色）。 */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return `rgba(212,165,116,${alpha})`; // 解析失败回退琥珀
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
