#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const repo = process.argv.includes("--repo")
  ? process.argv[process.argv.indexOf("--repo") + 1]
  : "/tmp/wt-001";
const only = process.argv.includes("--from")
  ? process.argv[process.argv.indexOf("--from") + 1]
  : null;

const stackDir = path.join(repo, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));
const rows = JSON.parse(fs.readFileSync(path.join(stackDir, "published-branches.json"), "utf8"));

function noUi(item) {
  if (!item.shots?.desktop) return true;
  const patches = item.patches ?? [];
  if (patches.length > 0 && patches.every((p) => /\.test\.|failureText|errors\.test/.test(p))) {
    return true;
  }
  if (/^test\(/.test(item.title) || item.slug?.includes("e2e-")) return true;
  if (item.series === "B-dashboard" && ["071", "072", "073"].includes(item.id)) return true;
  return false;
}

for (const row of rows) {
  if (only && row.id !== only) continue;
  const item = manifest.find((m) => m.id === row.id);
  if (!item || noUi(item)) {
    console.log("skip", row.id);
    continue;
  }
  console.log("capture", row.id);
  execFileSync("node", [path.join("/workspace/scripts/stack-pr/capture-published.mjs"), row.id, "--repo", repo], {
    stdio: "inherit",
  });
  const src = path.join(repo, "docs/stack-pr-screenshots", row.id);
  const dest = path.join("/workspace/docs/stack-pr-screenshots", row.id);
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, f), path.join(dest, f));
    }
  }
}
