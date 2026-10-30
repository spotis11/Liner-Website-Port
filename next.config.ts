import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: false,
  // keep undici external so instrumentation.ts wires the raised
  // response-header cap into the real Node global fetch; the z-ai SDK stays
  // external so its runtime config lookup (/etc/.z-ai-config) is untouched;
  // nodemailer is dynamically imported by the mailer and NOT reliably traced
  // into the standalone output — keep it a runtime require (the build script
  // copies it into .next/standalone/node_modules explicitly)
  serverExternalPackages: ["undici", "z-ai-web-dev-sdk", "nodemailer"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async rewrites() {
    return {
      // serve the genuine Liner SPA (built from tryliner/desktop sources)
      // at the root; everything under /api/* stays in Next.js
      beforeFiles: [
        { source: "/", destination: "/liner/index.html" },
        { source: "/login", destination: "/liner/index.html" },
        { source: "/library", destination: "/liner/index.html" },
        { source: "/artist", destination: "/liner/index.html" },
        { source: "/collection", destination: "/liner/index.html" },
        { source: "/player", destination: "/liner/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/cover-sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
