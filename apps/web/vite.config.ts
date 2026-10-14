import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite-plus";

/**
 * OCR（tesseract.js）の実行ファイルと日本語の学習データを public/ocr に置く（自前で配信し、外部 CDN を使わない）。
 * 大きいのでリポジトリには入れず、開発・ビルドの開始時に node_modules から写す（public/ocr は gitignore）。
 */
function ocrAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const out = fileURLToPath(new URL("./public/ocr", import.meta.url));
  const copy = (from: string, name: string) => {
    const to = join(out, name);
    if (existsSync(to) && statSync(to).size === statSync(from).size) return;
    copyFileSync(from, to);
  };
  return {
    name: "mf100-ocr-assets",
    buildStart() {
      try {
        mkdirSync(join(out, "core"), { recursive: true });
        mkdirSync(join(out, "lang"), { recursive: true });
        copy(require.resolve("tesseract.js/dist/worker.min.js"), "worker.min.js");
        const core = dirname(
          createRequire(require.resolve("tesseract.js")).resolve("tesseract.js-core/package.json"),
        );
        for (const f of [
          "tesseract-core-lstm.wasm.js",
          "tesseract-core-simd-lstm.wasm.js",
          "tesseract-core-relaxedsimd-lstm.wasm.js",
        ])
          copy(join(core, f), join("core", f));
        for (const lang of ["jpn", "jpn_vert"]) {
          const dir = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
          copy(
            join(dir, "4.0.0_best_int", `${lang}.traineddata.gz`),
            join("lang", `${lang}.traineddata.gz`),
          );
        }
      } catch (e) {
        this.warn(`OCR のファイルを用意できませんでした（OCR は使えません）: ${String(e)}`);
      }
    },
  };
}

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
    ocrAssets(),
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
