#!/usr/bin/env node
/** linear ブランチの各コミットを stacked PR として publish（meta は artifacts/stack-pr/<id>/） */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));

function sh(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

const commits = sh("git log --reverse --format=%H develop..cursor/stack-linear-8b5a").split("\n").filter(Boolean);
if (commits.length !== manifest.length) {
  console.warn("commit/manifest mismatch", commits.length, manifest.length);
}

let parent = "develop";
for (let i = 0; i < Math.min(commits.length, manifest.length); i++) {
  const item = manifest[i];
  const sha = commits[i];
  const branch = `cursor/stack-${item.id}-${item.slug}-8b5a`;
  sh(`git branch -f ${branch} ${sha}`);
  sh(`git push -u origin ${branch} --force`);
  console.log(item.id, branch, "<-", parent);
  parent = branch;
}

console.log("done", commits.length);
