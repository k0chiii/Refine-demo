#!/usr/bin/env node
/**
 * Cloud Agent 用: 残り PR 本文を ManagePullRequest 相当で更新するため、
 * 各 ID の branch と body ファイルパスを JSON Lines で stdout に出す。
 * エージェントは 1 行ずつ ManagePullRequest update_pr を実行する。
 */
import fs from "node:fs";

const skip = new Set(process.argv[2]?.split(",") ?? []);
const rows = JSON.parse(
  fs.readFileSync(new URL("./published-branches.json", import.meta.url), "utf8"),
);
for (const row of rows) {
  if (skip.has(row.id)) continue;
  const bodyPath = `/workspace/artifacts/stack-pr/${row.id}/pr-body.md`;
  if (!fs.existsSync(bodyPath)) continue;
  console.log(JSON.stringify({ branch_name: row.branch, bodyPath, id: row.id }));
}
