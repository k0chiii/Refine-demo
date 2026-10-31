#!/usr/bin/env node
/** v2 linear の 062 以降: applyItem 失敗時は stack-linear-8b5a から同名コミットを cherry-pick --no-commit */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { applyItem } from "./edits.mjs";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));
const linear = "origin/cursor/stack-linear-8b5a";

function sh(cmd, inherit = true) {
  execSync(cmd, { cwd: root, stdio: inherit ? "inherit" : "pipe" });
}
function shOut(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

const from = process.argv[2] ?? "062";
const start = manifest.findIndex((m) => m.id === from);
sh(`git fetch origin cursor/stack-linear-8b5a`);
sh(`git checkout cursor/stack-linear-v2-8b5a`);

const titleAliases = {
  "copy(make): 「あなたの番」→「要対応」": [
    "copy(make): 「あなたの番」→「要対応」",
    "ui(make): 「あなたの番」見出しをやめ件数バッジで区切る",
    "review+copy: ce0b91f/44dba54 参考実装（選択中のみ採否・要対応）",
  ],
  "test(e2e): 採否は選択中のみ・反映しないで理由にフォーカス @smoke": [
    "test(e2e): 採否は選択中のみ・反映しないで理由にフォーカス @smoke",
    "test(e2e): 反映ボタン行に合わせ decision spec を更新",
  ],
};

function findSha(title) {
  const tries = titleAliases[title] ?? [title];
  for (const t of tries) {
    const line = shOut(
      `git log ${linear} --format=%H%x09%s -F --fixed-strings -- ${JSON.stringify(t)} 2>/dev/null | head -1`,
    );
    if (line) return line.split("\t")[0];
    const all = shOut(`git log ${linear} --format=%H%x09%s`).split("\n");
    const hit = all.find((l) => l.includes(t));
    if (hit) return hit.split("\t")[0];
  }
  return null;
}

for (const item of manifest.slice(start)) {
  console.log("\n=== ", item.id, item.title);
  let applied = false;
  try {
    applyItem(item);
    applied = true;
  } catch (e) {
    console.warn("applyItem failed, cherry-pick:", e.message?.slice?.(0, 80));
  }
  if (!applied) {
    const sha = findSha(item.title);
    if (!sha) {
      console.error("no commit for", item.title);
      process.exit(1);
    }
    sh(`git cherry-pick ${sha} --no-commit`);
  }
  sh("git add -A");
  sh(`git commit -m "${item.title.replace(/"/g, '\\"')}"`);
}

sh("git push -u origin cursor/stack-linear-v2-8b5a");
