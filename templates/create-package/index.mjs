#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
export function createPackage(root, name, layer = "domain") {
  if (!/^[a-z][a-z0-9-]{0,48}$/.test(name) || !["domain", "application"].includes(layer))
    throw new Error("Specify a lowercase package name and domain/application layer");
  const target = path.join(root, "packages", name);
  if (fs.existsSync(target)) throw new Error("Package already exists");
  const files = {
    "package.json":
      JSON.stringify(
        {
          name: `@mf100/${name}`,
          version: "0.1.0",
          private: true,
          type: "module",
          sideEffects: false,
          exports: { ".": { types: "./src/index.ts", default: "./src/index.ts" } },
          scripts: { test: "vp test run", typecheck: "vp run verify-types", pack: "vp pack" },
          ...(layer === "application" ? { dependencies: { "@mf100/domain": "workspace:*" } } : {}),
          devDependencies: { typescript: "5.9.3", "vite-plus": "1.2.0" },
        },
        null,
        2,
      ) + "\n",
    "tsconfig.json":
      JSON.stringify(
        {
          extends: "../../tsconfig.base.json",
          compilerOptions: { types: [] },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ) + "\n",
    "src/index.ts": "export {};\n",
    "vite.config.ts": `import { defineConfig } from "vite-plus";\nimport { taskCache } from "../../scripts/task-cache.ts";\nexport default defineConfig({ run: { tasks: { "verify-types": { command: "tsc -p tsconfig.json --noEmit", cache: taskCache() } } }, test: { name: "${name}", include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true }, pack: { entry: ["src/index.ts"], dts: true } });\n`,
  };
  for (const [file, text] of Object.entries(files)) {
    const dest = path.join(target, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, { flag: "wx" });
  }
  return target;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const name = (process.argv[2] ?? "").replace(/^packages\//, "");
  console.log(createPackage(root, name, process.argv[3]));
}
