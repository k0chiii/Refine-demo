#!/usr/bin/env node
/** PR 作成用ペイロードを JSONL に書く（エージェントが ManagePullRequest に流用） */
import fs from "node:fs";
import path from "node:path";

const stackDir = path.join("/workspace/scripts/stack-pr");
const rows = JSON.parse(fs.readFileSync(path.join(stackDir, "published-branches.json"), "utf8"));
const outPath = path.join(stackDir, "pr-create-payloads.jsonl");
const skip = new Set((process.argv[2] || "").split(",").filter(Boolean));

const lines = [];
for (const row of rows) {
  if (row.id === "001" || skip.has(row.id)) continue;
  let body = fs.readFileSync(
    path.join("/workspace/artifacts/stack-pr", row.id, "pr-body.md"),
    "utf8",
  );
  body = body.replace(/node scripts\/stack-pr\/run-one\.mjs --from \d+/g, (m) =>
    m.replace("run-one.mjs", "capture-published.mjs").replace("--from ", ""),
  );
  lines.push(
    JSON.stringify({
      id: row.id,
      title: row.title,
      branch_name: row.branch,
      base_branch: row.base,
      body,
    }),
  );
}
fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log("wrote", lines.length, "payloads to", outPath);
