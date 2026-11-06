import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const phase = process.argv[2];
if (phase !== "before" && phase !== "after") {
  console.error("usage: node capture-all.mjs before|after");
  process.exit(1);
}
const outDir = path.join(here, phase);
fs.mkdirSync(outDir, { recursive: true });

/** 主色がはっきり見える実画面のみ（UI を隠したり加工しない） */
const scenes = [
  "33-work-form",
  "q63b-admin-csv",
  "q63b-admin-register",
  "q63b-works-chip",
  "q63b-works-dashboard",
  "q63b-editor-toolbar",
  "q63b-admin-tab",
  "02-works-list",
  "27-make-creator",
  "12-submit-dialog",
];

for (const scene of scenes) {
  const prefix = path.join(outDir, scene);
  const req = path.join(os.tmpdir(), `mf100-q63b-${phase}-${scene}.json`);
  fs.writeFileSync(
    req,
    JSON.stringify({ shots: { desktop: scene }, prefix, opts: { expandOverview: true } }),
  );
  const port = String(4300 + scenes.indexOf(scene));
  const skipBuild = scenes.indexOf(scene) > 0 ? "1" : (process.env.SKIP_DEMO_BUILD ?? "");
  const r = spawnSync("pnpm", ["dlx", "tsx", "scripts/stack-pr/capture-cli.ts", req], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      STACK_PR_REPO: repoRoot,
      CAPTURE_PORT: port,
      BASE_URL: `http://127.0.0.1:${port}`,
      CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? "/usr/bin/google-chrome",
      SCREENSHOT_CORPUS: outDir,
      SKIP_DEMO_BUILD: skipBuild,
      CAPTURE_THEME: phase === "before" ? "before" : "after",
    },
  });
  fs.unlinkSync(req);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
