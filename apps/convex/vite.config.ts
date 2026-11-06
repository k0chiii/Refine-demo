import { taskCache } from "../../scripts/task-cache.ts";
import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      "generate-convex": {
        command: "node scripts/codegen.mjs",
        cache: {
          ...taskCache(["convex/_generated/*.ts", "convex/_generated/*.js"]),
          input: [
            ...taskCache().input,
            { pattern: "!apps/convex/convex/_generated/**", base: "workspace" },
          ],
        },
      },
      "verify-types": {
        command: "tsc -p convex/tsconfig.json --noEmit",
        dependsOn: [],
        cache: taskCache(),
      },
    },
  },

  test: {
    name: "convex",
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
});
