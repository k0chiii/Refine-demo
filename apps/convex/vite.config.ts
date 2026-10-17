import { defineConfig } from "vite-plus";

export default defineConfig({
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
