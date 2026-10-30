#!/usr/bin/env node
/** 057 ブランチから manifest 058 以降を v2 linear に積む */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { applyItem } from "./edits.mjs";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));
const parent057 = "origin/cursor/stack-057-copy-apps-web-src-ui-DateField-tsx-patch-8b5a";
const linearV2 = "cursor/stack-linear-v2-8b5a";

function sh(cmd) {
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

const from = process.argv.includes("--from")
  ? process.argv[process.argv.indexOf("--from") + 1]
  : "058";

sh(`git fetch origin develop ${parent057.replace("origin/", "")} cursor/stack-linear-8b5a`);
const startIdx = manifest.findIndex((m) => m.id === from);
if (startIdx < 0) process.exit(1);

if (from === "058") {
  sh(`git checkout -B ${linearV2} ${parent057}`);
} else {
  sh(`git checkout ${linearV2}`);
}

for (const item of manifest.slice(startIdx)) {
  console.log("\n=== commit", item.id, item.title);
  applyItem(item);
  sh("git add -A");
  sh(`git commit -m "${item.title.replace(/"/g, '\\"')}"`);
}

sh(`git push -u origin ${linearV2}`);
