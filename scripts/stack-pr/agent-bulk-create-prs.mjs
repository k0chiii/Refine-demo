#!/usr/bin/env node
/**
 * Cloud Agent 用: 未作成 PR の ManagePullRequest 入力を stdout に出す。
 * 親エージェントが 1 行 JSON ごとに create_pr する想定（gh create は integration 権限不足）。
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const root = "/workspace";
const argsDir = `${root}/artifacts/stack-pr/manage-args`;
const done = new Set(
  execFileSync("gh", ["pr", "list", "--limit", "200", "--json", "headRefName", "--jq", ".[].headRefName"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean),
);

for (const file of fs.readdirSync(argsDir).sort()) {
  if (!file.endsWith(".json")) continue;
  const id = file.replace(".json", "");
  const a = JSON.parse(fs.readFileSync(`${argsDir}/${file}`, "utf8"));
  if (done.has(a.branch_name)) {
    console.log(JSON.stringify({ id, skip: true, branch: a.branch_name }));
    continue;
  }
  console.log(JSON.stringify({ id, action: "create_pr", ...a }));
}
