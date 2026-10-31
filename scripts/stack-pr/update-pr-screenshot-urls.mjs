#!/usr/bin/env node
/** Update PR bodies: replace raw.githubusercontent.com/<sha>/ with new docs SHA */
import { execFileSync } from "node:child_process";

const sha = process.argv[2];
if (!sha) {
  console.error("usage: update-pr-screenshot-urls.mjs <docs-commit-sha>");
  process.exit(1);
}

const prs = [175, 177, 181, 180, 179, 176, 178, 185, 183, 184, 182, 165, 163, 162, 168, 167, 169];

for (const n of prs) {
  const json = execFileSync("gh", ["pr", "view", String(n), "--json", "body"], { encoding: "utf8" });
  const { body } = JSON.parse(json);
  const next = body.replace(
    /https:\/\/raw\.githubusercontent\.com\/k0chiii\/Refine-demo\/[0-9a-f]+\//g,
    `https://raw.githubusercontent.com/k0chiii/Refine-demo/${sha}/`,
  );
  if (next === body) continue;
  execFileSync("gh", ["pr", "edit", String(n), "--body", next], { stdio: "inherit" });
  console.log("updated PR", n);
}
