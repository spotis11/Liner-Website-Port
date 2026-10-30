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
  // The tracer pulls the whole workspace (skills/ design templates, scripts/,
  // docs/, multi-platform sharp binaries, typescript) into every route's
  // standalone trace — the deploy tarball hit 127MB and blows past the FC
  // ~100MB upload limit. None of these are needed at runtime.
  outputFileTracingExcludes: {
    "*": [
      "./skills/**/*",
      "./scripts/**/*",
      "./docs/**/*",
      "./download/**/*",
      "./upload/**/*",
      "./mini-services/**/*",
      "./discord-bot/**/*",
      "./liner-ref/**/*",
      "./db/*.json",
      "./node_modules/typescript/**/*",
      "./node_modules/@img/sharp-linuxmusl-*",
      "./node_modules/@img/sharp-linux-arm*",
      "./node_modules/@img/libvips-linuxmusl-*",
      "./node_modules/@img/libvips-linux-arm*",
    ],
  },
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
