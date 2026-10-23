import { taskCache } from "../../scripts/task-cache.ts";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite-plus";
import { shellPrecache } from "./pwa/shellPrecache.ts";

/** Component test registries also glob their own Node-only tests; only runtime modules belong in the browser demo. */
function browserComponentModules(): Plugin {
  return {
    name: "browser-component-modules",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/@convex-dev/") || !id.endsWith("/src/test.ts")) return;
      return code.replaceAll(
        'import.meta.glob("./component/**/*.ts")',
        'import.meta.glob(["./component/**/*.ts", "!./component/**/*.test.ts", "!./component/**/*.spec.ts", "!./component/**/*.helpers.ts"])',
      );
    },
  };
}

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
        // LSTM の SIMD を 1 本だけ。extract.ts がこのファイルを直接指定する。
        const wasm = "tesseract-core-simd-lstm.wasm.js";
        copy(join(core, wasm), join("core", wasm));
        const lang = "jpn";
        const dir = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
        copy(
          join(dir, "4.0.0_best_int", `${lang}.traineddata.gz`),
          join("lang", `${lang}.traineddata.gz`),
        );
      } catch (e) {
        this.warn(`OCR のファイルを用意できませんでした（OCR は使えません）: ${String(e)}`);
      }
    },
  };
}

/**
 * PWA: ビルドのときだけ Service Worker（pwa/sw.template.js）を sw.js として書き出す。
 * install で先に取るのは外枠だけ（index.html、エントリとその静的 import、その CSS、マニフェストとアイコン）。
 * 画面のチャンクはここには入れない。sw.template.js が /assets/ を実行時にキャッシュ優先で残す。
 * フォント（日本語は数百の分割ファイル）は先読みせず、使ったものだけキャッシュする。
 */
function pwa(): Plugin {
  const template = fileURLToPath(new URL("./pwa/sw.template.js", import.meta.url));
  const fromPublic = [
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/icons/favicon-32.png",
    "/icons/badge-96.png",
  ];
  return {
    name: "mf100-pwa",
    apply: "build",
    generateBundle(_options, bundle) {
      // index.html は HTML の処理（vite:build-html）がこの後で書き出すため、bundle にまだ無いことがある。明示的に入れる
      const precache = shellPrecache(bundle, fromPublic);
      const version = createHash("sha256")
        .update(precache.join("\n"))
        .update(
          readFileSync(fileURLToPath(new URL("./public/manifest.webmanifest", import.meta.url))),
        )
        .update(readFileSync(template))
        .digest("hex")
        .slice(0, 12);
      const source = readFileSync(template, "utf8")
        .replace("__VERSION__", JSON.stringify(version))
        .replace("__PRECACHE__", JSON.stringify(precache));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/**
 * 接続先（Convex のデプロイ・ファイル API）への事前接続。HTML を読んだ時点で DNS・TCP・TLS を始めておくと、
 * JS を読み終えて WebSocket / fetch を張るときには接続が済んでいる（往復の遅い回線ではここだけで 1 秒以上違う）。
 * 接続先はビルド時の環境変数（VITE_CONVEX_URL・VITE_API_URL）から。デモ（バックエンド無し）では何も足さない。
 * - Convex: WebSocket は匿名・資格情報つきのどちらの接続プールを使うか実装による。両方を温める
 * - ファイル API: fetch（資格情報なしの CORS）なので crossorigin つき
 */
function preconnect(): Plugin {
  let tags: Array<{
    tag: "link";
    attrs: Record<string, string | boolean>;
    injectTo: "head-prepend";
  }> = [];
  return {
    name: "mf100-preconnect",
    configResolved(config) {
      tags = [];
      if (config.mode === "demo") return;
      const origin = (value: unknown) => {
        try {
          return typeof value === "string" && value ? new URL(value).origin : null;
        } catch {
          return null;
        }
      };
      const convex = origin(config.env.VITE_CONVEX_URL);
      const api = origin(config.env.VITE_API_URL);
      const link = (rel: string, href: string, crossorigin = false) =>
        tags.push({
          tag: "link",
          attrs: { rel, href, ...(crossorigin ? { crossorigin: "" } : {}) },
          injectTo: "head-prepend",
        });
      if (convex) {
        link("preconnect", convex);
        link("preconnect", convex, true);
        link("dns-prefetch", convex);
      }
      if (api && api !== convex) {
        link("preconnect", api, true);
        link("dns-prefetch", api);
      }
    },
    transformIndexHtml: () => tags,
  };
}

/**
 * `--mode demo`: バックエンド無しで動くデモモード。convex/react と Convex Auth、Hono API 呼び出しを
 * src/demo/* に差し替え、apps/convex の実際の関数を convex-test でブラウザ内実行する（UI 開発・E2E・スクショ用）。
 */
export default defineConfig(({ mode }) => ({
  run: {
    tasks: {
      "bundle-web": {
        command: "vp build",
        dependsOn: ["@mf100/convex#generate-convex"],
        cache: taskCache(["dist/**", "src/routeTree.gen.ts", "public/ocr/**"]),
      },
      "bundle-demo": {
        command: "vp build --mode demo --outDir dist-demo",
        dependsOn: ["@mf100/convex#generate-convex"],
        cache: taskCache(["dist-demo/**", "src/routeTree.gen.ts", "public/ocr/**"]),
      },
      "verify-types": {
        command: "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.e2e.json",
        dependsOn: ["bundle-web"],
        cache: taskCache(),
      },
    },
  },

  plugins: [
    ...(mode === "demo" ? [browserComponentModules()] : []),
    // ルートツリーは src/routeTree.gen.ts に自動生成（gitignore）。react() より前に置く。
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    preconnect(),
    ocrAssets(),
    pwa(),
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
  optimizeDeps:
    mode === "demo"
      ? {
          exclude: [
            "convex-test",
            "@convex-dev/presence/test",
            "@convex-dev/prosemirror-sync/test",
            "@convex-dev/workflow/test",
            "@convex-dev/aggregate/test",
            "@convex-dev/migrations/test",
            "@convex-dev/rate-limiter/test",
            "@convex-dev/workpool/test",
            "@convex-dev/batch-worker/test",
          ],
        }
      : {},
  // convex-test / @auth/core が参照する Node グローバルをブラウザで解決する（デモモードのみ）
  define:
    mode === "demo"
      ? { global: "globalThis", "process.env": "(globalThis.process ??= { env: {} }).env" }
      : {},
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
