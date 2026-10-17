import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "api",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
