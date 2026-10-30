#!/usr/bin/env node
/**
 * 公開済み stack ブランチで before（親）/ after（自身）を撮る。apply しない。
 * Usage: node capture-published.mjs [id] [id...]  省略時は manifest 全件
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { captureShots } from "./capture.mjs";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const rows = JSON.parse(fs.readFileSync(path.join(stackDir, "published-branches.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));
const byId = new Map(manifest.map((m) => [m.id, m]));

const ids = process.argv.slice(2).length ? process.argv.slice(2) : rows.map((r) => r.id);

function sh(cmd) {
  execSync(cmd, { cwd: root, stdio: "inherit" });
}

for (const id of ids) {
  const row = rows.find((r) => r.id === id);
  const item = byId.get(id);
  if (!row || !item) {
    console.warn("skip", id);
    continue;
  }
  const artDir = path.join(root, "artifacts/stack-pr", id);
  fs.mkdirSync(artDir, { recursive: true });
  const shots = item.shots ?? { desktop: "27-make-creator" };
  console.log("capture", id, row.base, "->", row.branch);
  sh(`git fetch origin ${row.base} ${row.branch} 2>/dev/null || git fetch origin`);
  sh(`git checkout ${row.base}`);
  await captureShots(shots, path.join(artDir, "before"));
  sh(`git checkout ${row.branch}`);
  await captureShots(shots, path.join(artDir, "after"));
}
