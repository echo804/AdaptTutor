/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // M6.1：生产 Docker 部署用 standalone（next build 输出自包含服务）
  output: "standalone",
};

export default nextConfig;
