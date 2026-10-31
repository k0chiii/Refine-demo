#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { captureShots } from "./capture.mjs";
import { validateScreenshotFile } from "./screenshot-validate.mjs";

const root = "/workspace";
const repo = process.env.STACK_PR_REPO ?? "/workspace/wt-cd-stack";
const manifest = JSON.parse(
  fs.readFileSync(`${root}/scripts/stack-pr/manifest-dashboard-cd.json`, "utf8"),
);
const outRoot = `${root}/docs/stack-pr-screenshots`;

const IDS = process.env.CAPTURE_IDS?.split(",") ?? ["083", "084", "085", "086", "087", "088"];
const PARENT_BRANCH = {
  "083": "cursor/stack-080-ui-sns-band-visibility-8b5a",
  "084": "cursor/stack-083-ui-role-home-manager-8b5a",
  "085": "cursor/stack-084-ui-role-home-approver-8b5a",
  "086": "cursor/stack-085-ui-role-home-member-8b5a",
  "087": "cursor/stack-086-ui-detail-shell-mock-8b5a",
  "088": "cursor/stack-087-ui-tablet-layout-8b5a",
};

function md5File(f) {
  return createHash("md5").update(fs.readFileSync(f)).digest("hex");
}

function checkout(branch) {
  execFileSync("git", ["fetch", "origin", branch], { cwd: repo, stdio: "inherit" });
  execFileSync("git", ["checkout", "-B", branch, `origin/${branch}`], { cwd: repo, stdio: "inherit" });
  try {
    execFileSync("pkill", ["-f", "vp preview"], { stdio: "ignore" });
  } catch {
    /* none */
  }
}

function dupesInDir(dir) {
  const map = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".png")) continue;
    const h = md5File(path.join(dir, name));
    map.set(h, (map.get(h) ?? 0) + 1);
  }
  return map;
}

for (const id of IDS) {
  const item = manifest.find((m) => m.id === id);
  if (!item?.shots?.desktop) throw new Error(`no shots for ${id}`);
  const shots =
    id === "088"
      ? {
          before: { desktop: "dashboard-manager", mobile: "dashboard-manager-mobile" },
          after: item.shots,
        }
      : { before: item.shots, after: item.shots };
  const branch = `cursor/stack-${id}-${item.slug}-8b5a`;
  const parent = PARENT_BRANCH[id];
  const dir = path.join(outRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const old of fs.readdirSync(dir).filter((n) => n.endsWith(".png"))) {
    fs.unlinkSync(path.join(dir, old));
  }

  const capOpts = {
    expandOverview: false,
    mobileWidth: id === "087" ? 768 : 412,
    mobileHeight: id === "086" ? 1400 : 915,
    desktopWidth: id === "087" ? 768 : 1280,
  };

  console.log(`\n=== capture ${id} parent ${parent} ===`);
  checkout(parent);
  await captureShots(shots.before, path.join(dir, "before"), {
    ...capOpts,
    expandOverview: id === "088" ? true : capOpts.expandOverview,
  });

  console.log(`=== capture ${id} after ${branch} ===`);
  checkout(branch);
  await captureShots(shots.after, path.join(dir, "after"), { ...capOpts, expandOverview: true });

  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".png"))) {
    const full = path.join(dir, name);
    const sceneKey = name.includes("mobile")
      ? (shots.after.mobile ?? `${shots.after.desktop}-mobile`)
      : shots.after.desktop;
    validateScreenshotFile(full, {
      sceneKey,
      pagePath: item.shots.desktop.includes("detail") ? "/w/" : "/works",
      corpusRoot: dir,
      selfPath: full,
    });
    const size = fs.statSync(full).size;
    console.log(name, size, md5File(full));
  }

  for (const [h, c] of dupesInDir(dir)) {
    if (c > 1) throw new Error(`duplicate md5 ${h} in ${dir}`);
  }
}

console.log("\nOK captured", IDS.join(", "));
