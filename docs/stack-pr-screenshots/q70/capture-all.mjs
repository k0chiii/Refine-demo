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

const scenes =
  phase === "before"
    ? [{ key: "33-work-form", file: "work-form-no-plan" }]
    : [
        { key: "q70-work-form-plan", file: "work-form-plan" },
        { key: "q70-info-tab-plan", file: "info-tab-plan" },
      ];

for (const { key, file } of scenes) {
  const prefix = path.join(outDir, file);
  const req = path.join(os.tmpdir(), `mf100-q70-${phase}-${file}.json`);
  fs.writeFileSync(req, JSON.stringify({ shots: { desktop: key }, prefix, opts: {} }));
  const r = spawnSync("pnpm", ["dlx", "tsx", "scripts/stack-pr/capture-cli.ts", req], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      STACK_PR_REPO: repoRoot,
      CAPTURE_PORT: "4321",
      BASE_URL: "http://127.0.0.1:4321",
      CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? "/usr/bin/google-chrome",
      SCREENSHOT_CORPUS: outDir,
      SKIP_PAMPHLET_COMMENTS: "1",
      SKIP_PLAN_INFO_WARNINGS: "1",
    },
  });
  fs.unlinkSync(req);
  if (r.status !== 0) process.exit(r.status ?? 1);
}
