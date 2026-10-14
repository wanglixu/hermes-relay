import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 单独跑（127.0.0.1:3220），不接管后端
  output: 'standalone',
  reactStrictMode: true,
  // 生产环境 /api 由 nginx 直连 Python(8788)，不经过 Next（SSE 少一跳）。
  // 这一条只是让本机自测（直接开 3220）也能通到后端。
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:8788/api/:path*' }]
  },
}

export default nextConfig
