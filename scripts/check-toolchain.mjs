import fs from "node:fs";
import { spawnSync } from "node:child_process";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const root = read("package.json");
const version = root.devDependencies["vite-plus"];
const workspace = fs.readFileSync("pnpm-workspace.yaml", "utf8");
if (!workspace.includes(`npm:@voidzero-dev/vite-plus-core@${version}`))
  throw new Error("Vite override differs from Vite+");
const vitest = spawnSync("pnpm", ["exec", "vp", "toolchain", "vitest"], { encoding: "utf8" });
if (vitest.status !== 0) throw new Error(vitest.stderr || "Cannot inspect bundled Vitest");
const bundledVitest = /vitest@(\d+\.\d+\.\d+)/.exec(vitest.stdout)?.[1];
if (!bundledVitest || !workspace.includes(`"vitest@*": ${bundledVitest}`))
  throw new Error(`Vitest override differs from bundled version: ${vitest.stdout.trim()}`);
console.log(
  `Toolchain aligned: Vite+ ${version}; Vitest ${vitest.stdout.trim()}; Node pin ${fs.readFileSync(".node-version", "utf8").trim()}; ${root.packageManager}`,
);
