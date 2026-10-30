#!/usr/bin/env node
/** Cloud Agent: ManagePullRequest update_pr 用 JSONL（親エージェントが 1 行ずつ適用） */
import fs from "node:fs";
import path from "node:path";

const rows = JSON.parse(
  fs.readFileSync(new URL("./published-branches.json", import.meta.url), "utf8"),
);
const from = process.argv[2] ?? "001";
const to = process.argv[3] ?? "076";
for (const row of rows) {
  if (row.id < from || row.id > to) continue;
  const body = fs.readFileSync(
    path.join("/workspace/artifacts/stack-pr", row.id, "pr-body.md"),
    "utf8",
  );
  console.log(JSON.stringify({ action: "update_pr", branch_name: row.branch, body }));
}
