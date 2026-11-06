#!/usr/bin/env node
/**
 * Stacked PR 1 本を処理: ブランチ作成 → before/after SS → 変更 → verify → commit → push → meta 出力
 * Usage: node run-one.mjs [--from id]   (manifest の id。省略時 .stack-next)
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { applyItem } from "./edits.mjs";
import { M3E_PAGES, m3eSection, decideSection } from "./m3e-snippets.mjs";
import { captureShots } from "./capture.mjs";

const root = "/workspace";
const stackDir = path.join(root, "scripts/stack-pr");
const stateFile = path.join(stackDir, ".stack-parent");
const nextFile = path.join(stackDir, ".stack-next");

const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));

function sh(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

function readParent() {
  return fs.existsSync(stateFile) ? fs.readFileSync(stateFile, "utf8").trim() : "develop";
}

function writeParent(branch) {
  fs.writeFileSync(stateFile, `${branch}\n`);
}

function m3eBody(keys) {
  const refs = keys.map((k) => M3E_PAGES[k] ?? k);
  return m3eSection({
    refs,
    aligned: [
      "色は `--mf-*` / `--md-sys-color-*` の色役割から取る",
      "コンポーネントは @m3e/react をそのまま使う",
    ],
    intentional: ["デモ用データの密度は mockups より低い（別 PR で足す）"],
  });
}

function verify(kind) {
  sh("pnpm check");
  sh("pnpm typecheck");
  sh("pnpm test");
  if (kind === "e2e-smoke" || kind === "full") {
    sh("pnpm --filter @mf100/web e2e:smoke");
  }
}

const argFrom = process.argv.includes("--from")
  ? process.argv[process.argv.indexOf("--from") + 1]
  : fs.existsSync(nextFile)
    ? fs.readFileSync(nextFile, "utf8").trim()
    : manifest[0].id;

const item = manifest.find((m) => m.id === argFrom);
if (!item) {
  console.error("manifest id not found", argFrom);
  process.exit(1);
}

const parent = readParent();
const branch = `cursor/stack-${item.id}-${item.slug}-8b5a`;
const artDir = path.join(root, "artifacts/stack-pr", item.id);
fs.mkdirSync(artDir, { recursive: true });

console.log("PR", item.id, item.title, "parent", parent);

sh(`git fetch origin develop`);
sh(`git checkout ${parent}`);
sh(`git checkout -B ${branch}`);

void captureShots(item.shots, path.join(artDir, "before"));

try {
  applyItem(item);
} catch (e) {
  console.error("apply failed", e.message);
  process.exit(2);
}

void captureShots(item.shots, path.join(artDir, "after"));
verify(item.verify);

sh("git add -A");
sh(`git commit -m "${item.title.replace(/"/g, '\\"')}"`);
sh(`git push -u origin ${branch}`);

writeParent(branch);
const next = manifest[manifest.findIndex((m) => m.id === item.id) + 1];
if (next) fs.writeFileSync(nextFile, next.id);
else fs.writeFileSync(nextFile, "done");

const body = [
  item.title,
  "",
  "## 概要",
  "",
  `- 系列: **${item.series}**`,
  `- 親ブランチ: \`${parent}\``,
  item.series.startsWith("B") || item.series.startsWith("C")
    ? "- モックアップ: `dashboard-research/mockups-m3e-v3/`（参考画像）"
    : "- 元コミット: uploads 0001–0009 を分解",
  "",
  "### スクリーンショット",
  "",
  "| | デスクトップ |",
  "|---|---|",
  `| before | ![before](/workspace/artifacts/stack-pr/${item.id}/before-desktop.png) |`,
  `| after | ![after](/workspace/artifacts/stack-pr/${item.id}/after-desktop.png) |`,
  item.shots.mobile
    ? `\n| before (mobile) | ![before-m](/workspace/artifacts/stack-pr/${item.id}/before-mobile.png) |\n| after (mobile) | ![after-m](/workspace/artifacts/stack-pr/${item.id}/after-mobile.png) |`
    : "",
  "",
  m3eBody(item.m3e ?? ["typography"]),
  "",
  decideSection(item.decide),
  "",
  "## 衝突メモ",
  "",
  "- 既存 PR #86（`cursor/transfer-work-creators-c30a`）は `WorksTable.tsx` を触る可能性あり。衝突したら #86 側を先に取り込む。",
  "",
  "## テスト",
  "",
  "- [x] pnpm check / typecheck / test" + (item.verify !== "standard" ? " / e2e smoke" : ""),
].join("\n");

fs.writeFileSync(path.join(artDir, "pr-body.md"), body);
fs.writeFileSync(
  path.join(artDir, "pr-meta.json"),
  JSON.stringify(
    { branch, base_branch: parent, title: item.title, bodyPath: path.join(artDir, "pr-body.md") },
    null,
    2,
  ),
);

console.log("OK", branch, "next", next?.id ?? "done");
