import { cloudflare } from "@cloudflare/vite-plugin";
import { taskCache } from "../../scripts/task-cache.ts";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => (process.env.VITEST ? [] : cloudflare())),
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
    name: "api",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
