import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "media", // 跟随系统（05 规范：明暗双主题跟随系统）
  theme: {
    extend: {
      fontFamily: {
        ui: ["-apple-system", '"PingFang SC"', '"Microsoft YaHei"', '"Source Han Sans SC"', "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", '"Courier New"', "monospace"],
      },
      colors: {
        // 主强调色：CSS 变量动态驱动（05 §2 色板，data-accent 可切换）
        primary: {
          DEFAULT: "var(--accent)",
          dark: "var(--accent)",
          light: "var(--accent-soft)",
        },
        // 副强调色（琥珀系）
        amber_accent: {
          DEFAULT: "var(--amber)",
          dark: "var(--amber)",
          light: "var(--amber-soft)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
