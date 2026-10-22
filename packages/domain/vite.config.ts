import { taskCache } from "../../scripts/task-cache.ts";
import { defineConfig } from "vite-plus";

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

  test: {
    name: "domain",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  pack: {
    entry: ["src/index.ts"],
    dts: true,
  },
});
