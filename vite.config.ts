import { defineConfig } from "vite-plus";

/**
 * Vite+ ワークスペースルート設定。
 * - fmt / lint はこのルート設定がワークスペース全体に適用される（パッケージ側で上書き不可）。
 * - test.projects で各パッケージの Vitest 設定を束ね、`vp test` 一発で全テストを実行する。
 */
export default defineConfig({
  create: {
    defaultTemplate: "mf100-package",
    templates: [
      {
        name: "mf100-package",
        description: "Source-exported TypeScript domain/application package",
        template: "./templates/create-package",
      },
    ],
  },
  run: {
    tasks: {
      "verify-static": { command: "vp check", dependsOn: ["@mf100/web#bundle-web"], cache: false },
    },
  },
  staged: { "*.{ts,tsx,js,mjs,json,jsonc,md,yaml,yml}": "vp check" },
  defaultPackage: "./apps/web",
  fmt: {
    semi: true,
    singleQuote: false,
    printWidth: 100,
    trailingComma: "all",
    ignorePatterns: [
      // `npx convex dev` が再生成する。lint と同じく整形対象にしない
      "apps/convex/convex/_generated/**",
      "apps/api/worker-configuration.d.ts",
      // `npx convex ai-files install` が置くベンダー文書。プロジェクトの整形規則で書き換えない
      "apps/convex/.agents/**",
      "apps/convex/.claude/**",
      // Claude Code の作業用ワークツリー（リポジトリの複製）
      ".claude/**",
      "research/**",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/dist-demo/**",
      "**/node_modules/**",
      "apps/convex/convex/_generated/**",
      "apps/api/worker-configuration.d.ts",
      "apps/web/src/routeTree.gen.ts",
      ".wrangler/**",
      ".claude/**",
      "research/**",
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // 依存の向きは tsconfig/ESLint ではなく package.json の dependencies で強制する
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      exclude: ["**/_generated/**", "**/test/**", "**/e2e/**", "**/routeTree.gen.ts"],
    },
    projects: ["packages/*", "apps/convex", "apps/api", "apps/web"],
  },
});
