import { defineConfig } from "vite-plus";

/**
 * Vite+ ワークスペースルート設定。
 * - fmt / lint はこのルート設定がワークスペース全体に適用される（パッケージ側で上書き不可）。
 * - test.projects で各パッケージの Vitest 設定を束ね、`vp test` 一発で全テストを実行する。
 */
export default defineConfig({
  defaultPackage: "./apps/web",
  fmt: {
    semi: true,
    singleQuote: false,
    printWidth: 100,
    trailingComma: "all",
    ignorePatterns: [
      // `npx convex dev` が再生成する。lint と同じく整形対象にしない
      "apps/convex/convex/_generated/**",
      // `npx convex ai-files install` が置くベンダー文書。プロジェクトの整形規則で書き換えない
      "apps/convex/.agents/**",
      "apps/convex/.claude/**",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/dist-demo/**",
      "**/node_modules/**",
      "apps/convex/convex/_generated/**",
      "apps/web/src/routeTree.gen.ts",
      ".wrangler/**",
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
    projects: ["packages/*", "apps/convex", "apps/api", "apps/web"],
  },
});
