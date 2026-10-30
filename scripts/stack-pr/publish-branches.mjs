#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

const logLines = sh("git log --reverse --format=%H%x09%s develop..HEAD")
  .split("\n")
  .filter(Boolean);
const commits = logLines.map((line) => {
  const i = line.indexOf("\t");
  return { sha: line.slice(0, i), subject: line.slice(i + 1) };
});

const byTitle = new Map(manifest.map((m) => [m.title, m]));
let parent = "develop";
const rows = [];

for (const c of commits) {
  const item = byTitle.get(c.subject);
  if (!item) {
    console.warn("skip commit (no manifest title)", c.subject);
    continue;
  }
  const branch = `cursor/stack-${item.id}-${item.slug}-8b5a`;
  sh(`git branch -f ${branch} ${c.sha}`);
  sh(`git push -u origin ${branch} --force`);
  rows.push({
    id: item.id,
    branch,
    base: parent,
    title: item.title,
    series: item.series,
    decide: item.decide?.length ? "あり" : "なし",
  });
  parent = branch;
}

fs.writeFileSync(path.join(stackDir, "published-branches.json"), JSON.stringify(rows, null, 2));
console.log("published", rows.length, "branches");
