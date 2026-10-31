#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { captureShots, SIGNIN_SCREEN_MD5 } from "./capture.mjs";
import { validateScreenshotFile } from "./screenshot-validate.mjs";

const root = "/workspace";
const repo = process.env.STACK_PR_REPO ?? "/workspace/wt-e-series";
const outRoot = `${root}/docs/stack-pr-screenshots`;
const manifest = JSON.parse(
  fs.readFileSync(`${root}/scripts/stack-pr/manifest-e-series.json`, "utf8"),
);

const BRANCH = {
  e089: "cursor/stack-e089-copy-unify-terminology-8b5a",
  e088: "cursor/stack-e088-drop-legacy-id-ui-8b5a",
  e078: "cursor/stack-e078-reg-minimal-fields-8b5a",
  e081: "cursor/stack-e081-dates-approval-target-finish-8b5a",
  e082: "cursor/stack-e082-revision-planned-dates-list-8b5a",
};

function md5File(f) {
  return createHash("md5").update(fs.readFileSync(f)).digest("hex");
}

function killPreview() {
  try {
    execFileSync("pkill", ["-f", "vp preview"], { stdio: "ignore" });
  } catch {
    /* none */
  }
}

function checkout(ref) {
  execFileSync("git", ["fetch", "origin", ref.replace(/^origin\//, "")], { cwd: repo, stdio: "inherit" });
  execFileSync("git", ["checkout", "-f", ref.startsWith("origin/") ? ref : `origin/${ref}`], {
    cwd: repo,
    stdio: "inherit",
  });
  killPreview();
}

function baseRef(item) {
  if (item.parent === "develop") return "origin/develop";
  return `origin/${BRANCH[item.parent]}`;
}

function branchRef(id) {
  return `origin/${BRANCH[id]}`;
}

const ids = process.argv.slice(2);
const items = manifest.filter((m) => (ids.length ? ids.includes(m.id) : true));

for (const item of items) {
  if (!item.shots?.desktop) continue;
  const dir = path.join(outRoot, item.id);
  fs.mkdirSync(dir, { recursive: true });
  const shots = item.shots;

  console.log(`\n=== ${item.id} before (${baseRef(item)}) ===`);
  checkout(baseRef(item));
  await captureShots(shots, path.join(dir, "before"), {
    mobileWidth: 412,
    expandOverview: false,
  });
  for (const suffix of ["desktop", "mobile"]) {
    const f = path.join(dir, `before-${suffix}.png`);
    if (!fs.existsSync(f)) continue;
    validateScreenshotFile(f, {
      sceneKey: shots.desktop,
      pagePath: "/works",
    });
  }

  console.log(`=== ${item.id} after (${branchRef(item.id)}) ===`);
  checkout(branchRef(item.id));
  await captureShots(shots, path.join(dir, "after"), {
    mobileWidth: 412,
    expandOverview: false,
  });
  for (const suffix of ["desktop", "mobile"]) {
    const f = path.join(dir, `after-${suffix}.png`);
    if (!fs.existsSync(f)) continue;
    const beforeF = path.join(dir, `before-${suffix}.png`);
    const skipDup =
      suffix === "mobile" &&
      fs.existsSync(beforeF) &&
      md5File(f) === md5File(beforeF) &&
      md5File(path.join(dir, "after-desktop.png")) !== md5File(path.join(dir, "before-desktop.png"));
    validateScreenshotFile(f, {
      sceneKey: shots.desktop,
      pagePath: "/works",
      ...(skipDup ? {} : { corpusRoot: dir, selfPath: f }),
    });
  }
}

for (const id of ["e089", "e088", "e078", "e081", "e082"]) {
  const dir = path.join(outRoot, id);
  if (!fs.existsSync(dir)) continue;
  const dirHashes = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".png")) continue;
    const full = path.join(dir, name);
    const h = md5File(full);
    const stat = fs.statSync(full);
    console.log(`${id}/${name} ${stat.size} bytes md5=${h}`);
    if (stat.size < 30_000) {
      console.error("FAIL size", full);
      process.exitCode = 1;
    }
    if (h === SIGNIN_SCREEN_MD5) {
      console.error("FAIL signin", full);
      process.exitCode = 1;
    }
    if (dirHashes.has(h)) {
      const mobilePair =
        name.endsWith("-mobile.png") &&
        dirHashes.get(h)?.endsWith("-mobile.png") &&
        name.startsWith("before") !== dirHashes.get(h)?.startsWith("before");
      if (!mobilePair) {
        console.error("FAIL duplicate md5 in", dir, h, name, dirHashes.get(h));
        process.exitCode = 1;
      }
    }
    dirHashes.set(h, name);
  }
}
console.log("done");
