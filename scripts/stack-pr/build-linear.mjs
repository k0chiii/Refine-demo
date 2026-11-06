#!/usr/bin/env node
/** develop から manifest 順にコミットを積む（cursor/stack-linear-8b5a） */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { applyItem } from "./edits.mjs";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));

function sh(cmd) {
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

const from = process.argv.includes("--from")
  ? process.argv[process.argv.indexOf("--from") + 1]
  : manifest[0].id;

sh("git fetch origin develop");
sh("git checkout develop");
sh("git checkout -B cursor/stack-linear-8b5a");

const start = manifest.findIndex((m) => m.id === from);
for (const item of manifest.slice(start)) {
  console.log("\n=== commit", item.id, item.title);
  try {
    applyItem(item);
  } catch (e) {
    console.error("FAILED", item.id, e.message);
    process.exit(1);
  }
  sh("git add -A");
  sh(`git commit -m "${item.title.replace(/"/g, '\\"')}"`);
}

sh("git log --oneline develop..HEAD | wc -l");
