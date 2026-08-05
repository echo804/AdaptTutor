"use client";

import katex from "katex";

/** 将文本中的 $...$ 数学公式渲染为 KaTeX（对齐 02：对话界面 KaTeX）。 */
export default function MathText({ text }: { text: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith("$") && p.endsWith("$") && p.length > 2) {
          const html = katex.renderToString(p.slice(1, -1), { throwOnError: false });
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}
