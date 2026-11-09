import { fileURLToPath } from "node:url";
import { taskCache } from "../../scripts/task-cache.ts";
import { defineConfig } from "vite-plus";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * application 層のテスト 40 本を、インメモリの代わりに SQLite のアダプタで走らせる。
 * テストが `../testing/inMemory.ts` を import する所だけを差し替える（契約は同じなので、テストは 1 行も変えない）。
 * 同じテストが通ることが「Convex なしで全ユースケースが動く」ことの証拠になる。
 */
export default defineConfig({
  run: {
    tasks: {
      "verify-types": {
        command: "tsc -p tsconfig.json --noEmit",
        dependsOn: [],
        cache: taskCache(),
      },
    },
  },
  resolve: {
    alias: [{ find: /^.*\/testing\/inMemory\.ts$/, replacement: here("./src/testing/context.ts") }],
  },
  test: {
    name: "cloudflare",
    include: ["src/**/*.test.ts", "../../packages/application/src/__tests__/*.test.ts"],
    environment: "node",
  },
});
