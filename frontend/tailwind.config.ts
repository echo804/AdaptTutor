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
        // 浅色主题：墨蓝主强调色（05 §2）
        primary: {
          DEFAULT: "#2c3e50", // 墨蓝（克制、安静）
          dark: "#1f2d3a",
          light: "#eef1f4",
        },
        // 暗色主题：琥珀主强调色（05 §2）
        amber_accent: {
          DEFAULT: "#d4a574", // 一束温暖的光
          dark: "#c08a54",
          light: "#f5e6c8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
