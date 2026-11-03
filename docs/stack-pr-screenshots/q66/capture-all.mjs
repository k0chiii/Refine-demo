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

const scene = phase === "before" ? "editor-comments-header" : "editor-comments-q66";
const prefix = path.join(outDir, scene);
const req = path.join(os.tmpdir(), `mf100-q66-${phase}.json`);
fs.writeFileSync(
  req,
  JSON.stringify({
    shots: { desktop: scene },
    prefix,
    opts: {},
  }),
);
const r = spawnSync("pnpm", ["dlx", "tsx", "scripts/stack-pr/capture-cli.ts", req], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    STACK_PR_REPO: repoRoot,
    CAPTURE_PORT: "4320",
    BASE_URL: "http://127.0.0.1:4320",
    CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? "/usr/bin/google-chrome",
    SCREENSHOT_CORPUS: outDir,
    SKIP_PAMPHLET_COMMENTS: phase === "before" ? "1" : "0",
  },
});
fs.unlinkSync(req);
process.exit(r.status ?? 1);
