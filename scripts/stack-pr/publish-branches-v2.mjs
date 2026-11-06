#!/usr/bin/env node
/**
 * manifest コミット列をブランチ化。058+ は -v2 サフィックス、force push 禁止。
 * 001–057 は既存 published-branches.json を維持（再 publish しない）。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));
const linearBranch = process.argv.includes("--linear")
  ? process.argv[process.argv.indexOf("--linear") + 1]
  : "cursor/stack-linear-v2-8b5a";
const v2From = process.argv.includes("--v2-from")
  ? process.argv[process.argv.indexOf("--v2-from") + 1]
  : "058";

function sh(cmd, inherit = false) {
  execSync(cmd, {
    cwd: root,
    encoding: inherit ? undefined : "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
}

function shOut(cmd) {
  return execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
}

const prevPath = path.join(stackDir, "published-branches.json");
const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, "utf8")) : [];
const prevById = new Map(prev.map((r) => [r.id, r]));

const logLines = shOut(`git log --reverse --format=%H%x09%s develop..${linearBranch}`)
  .split("\n")
  .filter(Boolean);
const commits = logLines.map((line) => {
  const i = line.indexOf("\t");
  return { sha: line.slice(0, i), subject: line.slice(i + 1) };
});

const byTitle = new Map(manifest.map((m) => [m.title, m]));
let parent =
  prevById.get(String(Number(v2From) - 1).padStart(3, "0"))?.branch ??
  `cursor/stack-${String(Number(v2From) - 1).padStart(3, "0")}-copy-apps-web-src-ui-DateField-tsx-patch-8b5a`;

const rows = prev.filter((r) => parseInt(r.id, 10) < parseInt(v2From, 10));

for (const c of commits) {
  const item = byTitle.get(c.subject);
  if (!item) {
    console.warn("skip commit (no manifest title)", c.subject);
    continue;
  }
  if (parseInt(item.id, 10) < parseInt(v2From, 10)) continue;

  const useV2 = parseInt(item.id, 10) >= parseInt(v2From, 10);
  const branch = useV2
    ? `cursor/stack-${item.id}-${item.slug}-v2-8b5a`
    : `cursor/stack-${item.id}-${item.slug}-8b5a`;

  shOut(`git branch ${branch} ${c.sha}`);
  sh(`git push -u origin ${branch}`, true);
  rows.push({
    id: item.id,
    branch,
    base: parent,
    title: item.title,
    series: item.series,
    decide: item.decide?.length ? "あり" : "なし",
    variant: useV2 ? "v2" : "v1",
  });
  parent = branch;
}

fs.writeFileSync(prevPath, JSON.stringify(rows, null, 2));
console.log("published v2 stack:", rows.filter((r) => r.variant === "v2").length);
