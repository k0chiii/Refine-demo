#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { captureShots } from "./capture.mjs";

const id = process.argv[2];
const locked = process.argv.includes("--locked");
const self = fileURLToPath(import.meta.url);
const repo = "/tmp/wt-001";
const workspace = "/workspace";
const lock = "/tmp/stack-pr-capture.lock";

function linkWorkspaceNodeModules() {
  const dirs = [
    "node_modules",
    "apps/web/node_modules",
    "apps/convex/node_modules",
    "apps/api/node_modules",
    "packages/domain/node_modules",
    "packages/application/node_modules",
  ];
  for (const d of dirs) {
    const src = path.join(workspace, d);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(repo, d);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.symlinkSync(src, dest, "dir");
    } catch {
      /* exists */
    }
  }
}

if (!id) {
  console.error("usage: node capture-published.mjs <id>");
  process.exit(1);
}

if (!locked) {
  execSync(`flock -w 7200 ${lock} ${process.execPath} ${JSON.stringify(self)} ${id} --locked`, {
    stdio: "inherit",
    shell: true,
  });
  process.exit(0);
}

function sh(cmd) {
  execSync(cmd, { cwd: repo, stdio: "inherit", shell: true });
}

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join("/workspace/scripts/stack-pr/manifest.json"), "utf8"),
  );
  const rows = JSON.parse(
    fs.readFileSync(path.join("/workspace/scripts/stack-pr/published-branches.json"), "utf8"),
  );
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
  process.env.PATH = `${path.join(workspace, "node_modules/.bin")}:${process.env.PATH ?? ""}`;
  linkWorkspaceNodeModules();
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

  sh("git checkout --force origin/develop");
  console.log("wrote", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
