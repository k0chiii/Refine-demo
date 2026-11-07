import { defineConfig } from "vite-plus";
import { taskCache } from "../../scripts/task-cache.ts";
export default defineConfig({
  run: {
    tasks: { "verify-types": { command: "tsc -p tsconfig.json --noEmit", cache: taskCache() } },
  },
  test: { name: "platform", include: ["src/**/*.test.ts"], environment: "node" },
  pack: { entry: ["src/index.ts"], dts: true },
});
