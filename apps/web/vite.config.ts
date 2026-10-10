import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite-plus";

/**
 * `--mode demo`: バックエンド無しで動くデモモード。convex/react と Convex Auth、Hono API 呼び出しを
 * src/demo/* に差し替え、apps/convex の実際の関数を convex-test でブラウザ内実行する（UI 開発・E2E・スクショ用）。
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    // ルートツリーは src/routeTree.gen.ts に自動生成（gitignore）。react() より前に置く。
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
  ],
  resolve: {
    alias: {
      // デモモードの差し替えは "@" より前に置く（alias は先頭から順に一致判定されるため）
      ...(mode === "demo"
        ? {
            "convex/react": fileURLToPath(new URL("./src/demo/convexReact.ts", import.meta.url)),
            "@convex-dev/auth/react": fileURLToPath(
              new URL("./src/demo/convexAuthReact.tsx", import.meta.url),
            ),
            "@/integrations/api": fileURLToPath(new URL("./src/demo/api.ts", import.meta.url)),
            "node:async_hooks": fileURLToPath(
              new URL("./src/demo/asyncLocalStorageShim.ts", import.meta.url),
            ),
          }
        : {}),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  optimizeDeps: mode === "demo" ? { exclude: ["convex-test"] } : {},
  // convex-test / @auth/core が参照する Node グローバルをブラウザで解決する（デモモードのみ）
  define: mode === "demo" ? { global: "globalThis", "process.env": "globalThis.process.env" } : {},
  server: { port: 5173, fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] } },
  build: {
    target: "es2022",
  },
  test: {
    name: "web",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
}));
