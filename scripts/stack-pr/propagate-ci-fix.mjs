#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = "/workspace";
const rows = JSON.parse(fs.readFileSync(`${root}/scripts/stack-pr/published-branches.json`, "utf8"));

function sh(args, opts = {}) {
  execFileSync(args[0], args.slice(1), { cwd: root, stdio: "inherit", ...opts });
}

sh(["git", "fetch", "origin", "develop"]);
for (const row of rows) {
  const { id, branch, base: parent } = row;
  console.log(`\n=== ${id} ${branch} <- ${parent}`);
  sh(["git", "fetch", "origin", branch, parent]);
  sh(["git", "checkout", "-B", branch, `origin/${branch}`]);
  sh(["git", "merge", `origin/${parent}`, "-m", `merge(${id}): ${parent} から CI/整形修正を取り込み`]);
  sh(["git", "push", "origin", branch]);
}
