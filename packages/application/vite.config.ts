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
    name: "application",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
