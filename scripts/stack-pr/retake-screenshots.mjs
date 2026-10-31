#!/usr/bin/env node
/**
 * Retake docs/stack-pr-screenshots from manifest (after merge 001-070).
 * Usage: node retake-screenshots.mjs [--only 071] [--ids 071,072]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { captureShots, SIGNIN_SCREEN_MD5 } from "./capture.mjs";
import { validateScreenshotFile, indexPngMd5 } from "./screenshot-validate.mjs";

const root = "/workspace";
const manifest = JSON.parse(fs.readFileSync(`${root}/scripts/stack-pr/manifest.json`, "utf8"));
const outRoot = process.env.SCREENSHOT_OUT ?? `${root}/docs/stack-pr-screenshots`;

const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1]
  ?? (process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null);
const idsArg = process.argv.find((a) => a.startsWith("--ids="))?.split("=")[1];

function md5File(f) {
  return createHash("md5").update(fs.readFileSync(f)).digest("hex");
}

function dupesInDir(dir) {
  const map = new Map();
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.endsWith(".png")) continue;
    const h = md5File(path.join(dir, f.name));
    map.set(h, (map.get(h) ?? 0) + 1);
  }
  return map;
}

const BRANCH_BY_ID = {
  "071": "cursor/stack-071-domain-work-stages-v7-v2-8b5a",
  "072": "cursor/stack-072-schema-revision-planned-at-v2-8b5a",
  "073": "cursor/stack-073-domain-danger-kpi-v2-8b5a",
  "074": "cursor/stack-074-demo-dashboard-role-homes-v2-8b5a",
  "075": "cursor/stack-075-ui-home-view-switcher-v2-8b5a",
  "076": "cursor/stack-076-detail-route-shell-v2-8b5a",
};

function shotsForItem(item) {
  if (item.id === "076") {
    return { desktop: "08-workspace-comment", mobile: "08-workspace-comment" };
  }
  if (["071", "072", "073", "074", "075"].includes(item.id)) {
    return { desktop: "dashboard-manager", mobile: "dashboard-manager-mobile" };
  }
  return item.shots;
}

function checkoutStackBranch(id) {
  const repo = process.env.STACK_PR_REPO;
  const branch = BRANCH_BY_ID[id];
  if (!repo || !branch) return;
  execFileSync("git", ["fetch", "origin", branch], { cwd: repo, stdio: "inherit" });
  execFileSync("git", ["checkout", "-B", branch, `origin/${branch}`], { cwd: repo, stdio: "inherit" });
  try {
    execFileSync("pkill", ["-f", "vp preview"], { stdio: "ignore" });
  } catch {
    /* none */
  }
}

let items = manifest;
if (onlyArg) items = items.filter((m) => m.id === onlyArg);
if (idsArg) {
  const set = new Set(idsArg.split(",").map((s) => s.trim()));
  items = items.filter((m) => set.has(m.id));
}

let retaken = 0;
const report = [];

for (const item of items) {
  if (!item.shots?.desktop) continue;
  const shots = shotsForItem(item);
  if (BRANCH_BY_ID[item.id]) checkoutStackBranch(item.id);
  const dir = path.join(outRoot, item.id);
  fs.mkdirSync(dir, { recursive: true });
  const before = path.join(dir, "before-desktop.png");
  const after = path.join(dir, "after-desktop.png");
  console.log(`\n=== ${item.id} ${item.title} ===`);
  try {
    const capOpts = { mobileWidth: 412, corpusRoot: outRoot, expandOverview: false };
    await captureShots(shots, path.join(dir, "before"), capOpts);
    await captureShots(shots, path.join(dir, "after"), { ...capOpts, expandOverview: true });
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".png"))) {
      const full = path.join(dir, f);
      validateScreenshotFile(full, {
        sceneKey: shots.desktop,
        pagePath: "/works",
        corpusRoot: outRoot,
        selfPath: full,
      });
    }
    retaken += fs.readdirSync(dir).filter((n) => n.endsWith(".png")).length;
    report.push({ id: item.id, dir, ok: true });
  } catch (e) {
    console.error("FAIL", item.id, e.message);
    report.push({ id: item.id, error: e.message });
    process.exitCode = 1;
  }
}

const allHashes = new Map();
for (const item of items) {
  const dir = path.join(outRoot, item.id);
  if (!fs.existsSync(dir)) continue;
  for (const [h, c] of dupesInDir(dir)) allHashes.set(h, (allHashes.get(h) ?? 0) + c);
}
console.log("\nretaken_png_count", retaken);
console.log("signin_hash_total", allHashes.get(SIGNIN_SCREEN_MD5) ?? 0);
fs.mkdirSync(`${root}/artifacts/stack-pr`, { recursive: true });
fs.writeFileSync(`${root}/artifacts/stack-pr/retake-report.json`, JSON.stringify({ retaken, report }, null, 2));
