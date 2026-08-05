import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "AdaptTutor 自适应学习",
  description: "AI 苏格拉底式辅导：诊断 → 路径 → 讲解 → 练习 → 反馈",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
