#!/usr/bin/env node
/**
 * before/after を同一 clone 上で checkout してキャプチャ（/tmp/wt-001 推奨）。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { captureShots } from "./capture.mjs";

const id = process.argv[2];
if (!id) {
  console.error("usage: node capture-published.mjs <id> [--repo /path]");
  process.exit(1);
}
const repo = process.argv.includes("--repo")
  ? process.argv[process.argv.indexOf("--repo") + 1]
  : "/tmp/wt-001";

function sh(cmd) {
  execSync(cmd, { cwd: repo, stdio: "inherit", shell: true });
}

async function main() {
  const stackDir = path.join(repo, "scripts/stack-pr");
  const manifestPath = path.join("/workspace/scripts/stack-pr/manifest.json");
  const rowsPath = path.join("/workspace/scripts/stack-pr/published-branches.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const rows = JSON.parse(fs.readFileSync(rowsPath, "utf8"));
  const item = manifest.find((m) => m.id === id);
  const row = rows.find((r) => r.id === id);
  if (!item || !row) {
    console.error("unknown id", id);
    process.exit(1);
  }
  if (!item.shots?.desktop) {
    console.log("skip (no shots)", id);
    return;
  }

  process.env.STACK_PR_REPO = repo;
  const outDir = path.join("/workspace/docs/stack-pr-screenshots", id);
  const tmpBefore = path.join("/workspace/artifacts/stack-pr", id, "cap-before");
  const tmpAfter = path.join("/workspace/artifacts/stack-pr", id, "cap-after");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(tmpBefore), { recursive: true });

  sh(`git fetch origin ${row.branch} ${row.base}`);

  if (row.base !== "develop") {
    sh(`git checkout --force origin/${row.base}`);
    sh("pnpm --filter @mf100/web build:demo");
    await captureShots(item.shots, tmpBefore);
    fs.copyFileSync(`${tmpBefore}-desktop.png`, path.join(outDir, "before-desktop.png"));
    if (item.shots.mobile && fs.existsSync(`${tmpBefore}-mobile.png`)) {
      fs.copyFileSync(`${tmpBefore}-mobile.png`, path.join(outDir, "before-mobile.png"));
    }
  }

  sh(`git checkout --force origin/${row.branch}`);
  sh("pnpm --filter @mf100/web build:demo");
  await captureShots(item.shots, tmpAfter);
  fs.copyFileSync(`${tmpAfter}-desktop.png`, path.join(outDir, "after-desktop.png"));
  if (item.shots.mobile && fs.existsSync(`${tmpAfter}-mobile.png`)) {
    fs.copyFileSync(`${tmpAfter}-mobile.png`, path.join(outDir, "after-mobile.png"));
  }

  if (id === "058" || id === "060") {
    const d58 = path.join("/workspace/docs/stack-pr-screenshots/058");
    fs.mkdirSync(d58, { recursive: true });
    fs.copyFileSync(
      path.join(outDir, "after-desktop.png"),
      path.join(d58, "x3-focused-comment.png"),
    );
    const mob = path.join(outDir, "after-mobile.png");
    if (fs.existsSync(mob)) {
      fs.copyFileSync(mob, path.join(d58, "x3b-mobile-focused-comment.png"));
    }
  }

  console.log("wrote", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
