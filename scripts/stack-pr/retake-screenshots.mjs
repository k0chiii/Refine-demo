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
import { validateScreenshotFile, indexPngMd5, validateDomSidecar } from "./screenshot-validate.mjs";

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

const PARENT_BRANCH_BY_ID = {
  "071": "develop",
  "072": "071",
  "073": "072",
  "074": "073",
  "075": "074",
  "076": "075",
};

const stackRepo = process.env.STACK_PR_REPO ?? `${root}/wt-cap-076`;

function checkoutStackBranch(id, parentKey) {
  const repo = stackRepo;
  let branch;
  if (parentKey === "develop") {
    execFileSync("git", ["fetch", "origin", "develop"], { cwd: repo, stdio: "inherit" });
    execFileSync("git", ["checkout", "-B", "develop", "origin/develop"], { cwd: repo, stdio: "inherit" });
  } else {
    const key = parentKey ?? id;
    branch = BRANCH_BY_ID[key];
    if (!branch) return;
    execFileSync("git", ["fetch", "origin", branch], { cwd: repo, stdio: "inherit" });
    execFileSync("git", ["checkout", "-B", branch, `origin/${branch}`], { cwd: repo, stdio: "inherit" });
  }
  try {
    execFileSync("pkill", ["-f", "vp preview"], { stdio: "ignore" });
  } catch {
    /* none */
  }
}

function shotsForItem(item) {
  if (item.id === "076") return { desktop: "dashboard-detail" };
  if (item.id === "075") {
    return { desktop: "27-make-creator", mobile: "27-make-creator" };
  }
  if (item.id === "074") {
    return { desktop: "dashboard-manager", mobile: "dashboard-manager-mobile" };
  }
  const s = item.shots;
  if (!s?.desktop) return s;
  return s.mobile ? { desktop: s.desktop, mobile: s.mobile } : { desktop: s.desktop };
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
  const dir = path.join(outRoot, item.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".png") || f.endsWith(".dom.txt")) fs.unlinkSync(path.join(dir, f));
  }
  console.log(`\n=== ${item.id} ${item.title} ===`);
  try {
    const capOpts = {
      mobileWidth: 412,
      corpusRoot: dir,
      expandOverview: false,
      ...(item.id === "076" ? { desktopHeight: 2400 } : {}),
      ...(item.id === "072" ? { desktopWidth: 1280 } : {}),
    };
    if (PARENT_BRANCH_BY_ID[item.id]) checkoutStackBranch(item.id, PARENT_BRANCH_BY_ID[item.id]);
    const beforeShots =
      item.id === "076" ? { desktop: "076-before-editor" } : shots;
    const afterShots =
      item.id === "076" ? { desktop: "dashboard-detail" } : shots;
    await captureShots(beforeShots, path.join(dir, "before"), capOpts);
    checkoutStackBranch(item.id, item.id);
    const afterOpts = { ...capOpts, expandOverview: true };
    if (item.id === "075") afterOpts.openViewSwitcher = true;
    if (item.id === "072") afterOpts.desktopWidth = 1281;
    await captureShots(afterShots, path.join(dir, "after"), afterOpts);
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".png"))) {
      const full = path.join(dir, f);
      const tag = f.startsWith("after-") ? "after" : "before";
      const shotDef = tag === "after" ? afterShots : beforeShots;
      const sceneKey = f.includes("mobile")
        ? (shotDef.mobile ?? `${shotDef.desktop}-mobile`)
        : shotDef.desktop;
      validateScreenshotFile(full, {
        sceneKey,
        pagePath: item.id === "076" ? "/works" : "/works",
        corpusRoot: dir,
        selfPath: full,
      });
      validateDomSidecar(full, sceneKey);
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
