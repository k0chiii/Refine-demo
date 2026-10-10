import { defineConfig } from "vite-plus";

export default defineConfig({
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
