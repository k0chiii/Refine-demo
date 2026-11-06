import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("pnpm", ["--filter", "@mf100/domain", "run", "pack"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
const source = JSON.parse(fs.readFileSync(path.join(root, "packages/domain/package.json"), "utf8"));
fs.writeFileSync(
  path.join(root, "packages/domain/dist/package.json"),
  JSON.stringify(
    {
      name: source.name,
      version: source.version,
      private: true,
      type: "module",
      sideEffects: false,
      exports: { ".": { types: "./index.d.mts", import: "./index.mjs" } },
      files: ["index.mjs", "index.d.mts"],
    },
    null,
    2,
  ) + "\n",
);
console.log("Prepared a self-contained distribution in packages/domain/dist; nothing published.");
