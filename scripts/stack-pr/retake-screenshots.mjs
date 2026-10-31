#!/usr/bin/env node
/**
 * Retake docs/stack-pr-screenshots from manifest (after merge 001-070).
 * Usage: node retake-screenshots.mjs [--only 071] [--ids 071,072]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureShots, SIGNIN_SCREEN_MD5 } from "./capture.mjs";

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
  const dir = path.join(outRoot, item.id);
  fs.mkdirSync(dir, { recursive: true });
  const before = path.join(dir, "before-desktop.png");
  const after = path.join(dir, "after-desktop.png");
  console.log(`\n=== ${item.id} ${item.title} ===`);
  try {
    const capOpts = { mobileWidth: 412 };
    await captureShots(item.shots, path.join(dir, "before"), capOpts);
    await captureShots(item.shots, path.join(dir, "after"), capOpts);
    for (const f of [before, after, path.join(dir, "before-mobile.png"), path.join(dir, "after-mobile.png")]) {
      if (!fs.existsSync(f)) continue;
      if (md5File(f) === SIGNIN_SCREEN_MD5) throw new Error(`signin md5 on ${f}`);
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
fs.writeFileSync(`${root}/artifacts/stack-pr/retake-report.json`, JSON.stringify({ retaken, report }, null, 2));
