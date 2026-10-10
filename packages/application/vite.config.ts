import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "application",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
