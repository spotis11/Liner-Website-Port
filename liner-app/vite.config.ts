import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import pkg from "./package.json" with { type: "json" };
import { contentSecurityPolicyPlugin } from "./vite.csp";

export default defineConfig(({ command, mode }) => {
  if (command === "serve") {
    const devSigningSecret = loadEnv(mode, process.cwd(), "LINER_").LINER_DEV_SIGNING_SECRET;
    if (devSigningSecret) process.env.LINER_DEV_SIGNING_SECRET = devSigningSecret;
  }

  return {
  base: "/liner/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicyPlugin(),
  ],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@classic": path.resolve(import.meta.dirname, "./src-classic"),
      "next/navigation": path.resolve(import.meta.dirname, "./src/lib/navigation.tsx"),
      "next/link": path.resolve(import.meta.dirname, "./src/lib/navigation.tsx"),
      "next/image": path.resolve(import.meta.dirname, "./src/components/ui/AppImage.tsx"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  };
});
