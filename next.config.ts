import type { NextConfig } from "next";

/**
 * COOP/COEP ヘッダ:
 * - wllama のマルチスレッドビルド（SharedArrayBuffer）と
 *   WebGPU バックエンドの安定動作には crossOriginIsolated 環境が必要。
 * - Cloudflare Pages にデプロイする場合は public/_headers に同等の設定を用意済み。
 */
const securityHeaders = [
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "require-corp",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
