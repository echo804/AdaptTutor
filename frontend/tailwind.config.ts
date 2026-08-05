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
      colors: {
        // 浅色主题：墨蓝主强调色
        primary: {
          DEFAULT: "#3b5bdb", // 墨蓝
          dark: "#2f49b0",
          light: "#e7ebfb",
        },
        // 暗色主题：琥珀主强调色（通过 .dark 覆盖见 globals.css）
        amber_accent: {
          DEFAULT: "#d9a441",
          dark: "#c08a2e",
          light: "#f5e6c8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
