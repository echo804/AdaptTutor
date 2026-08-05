import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import AppShell from "@/components/AppShell";
import { DomainProvider } from "@/lib/domain";

export const metadata: Metadata = {
  title: "AdaptTutor 自适应学习",
  description: "AI 苏格拉底式辅导：诊断 → 路径 → 讲解 → 练习 → 反馈",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 主题防闪烁：首帧前应用持久化的 data-mode / data-accent（与 lib/theme.ts 键一致） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m=localStorage.getItem('at_mode'),a=localStorage.getItem('at_accent'),d=document.documentElement;if(m&&m!=='auto')d.dataset.mode=m;if(a&&a!=='ink')d.dataset.accent=a;}catch(e){}`,
          }}
        />
      </head>
      <body>
        <DomainProvider>
          <AppShell>{children}</AppShell>
        </DomainProvider>
      </body>
    </html>
  );
}
