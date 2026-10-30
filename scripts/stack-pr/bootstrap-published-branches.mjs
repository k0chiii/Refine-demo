#!/usr/bin/env node
/** 001–057 を origin の v1 ブランチ名から published-branches.json を組み立てる */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));

function shOut(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

const remotes = new Set(
  shOut("git branch -r")
    .split("\n")
    .map((l) => l.trim().replace(/^origin\//, "")),
);

const rows = [];
let parent = "develop";
for (const item of manifest) {
  if (parseInt(item.id, 10) > 57) break;
  const branch = `cursor/stack-${item.id}-${item.slug}-8b5a`;
  if (!remotes.has(branch)) {
    console.warn("missing remote branch", branch);
  }
  rows.push({
    id: item.id,
    branch,
    base: parent,
    title: item.title,
    series: item.series,
    decide: item.decide?.length ? "あり" : "なし",
    variant: "v1",
  });
  parent = branch;
}

fs.writeFileSync(path.join(stackDir, "published-branches.json"), JSON.stringify(rows, null, 2));
console.log("wrote", rows.length, "v1 rows");
