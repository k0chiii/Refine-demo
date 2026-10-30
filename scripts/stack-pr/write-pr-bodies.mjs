#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { M3E_PAGES, m3eSection, decideSection } from "./m3e-snippets.mjs";

const stackDir = path.join("/workspace/scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));
const rows = JSON.parse(fs.readFileSync(path.join(stackDir, "published-branches.json"), "utf8"));
const byId = new Map(manifest.map((m) => [m.id, m]));

for (const row of rows) {
  const item = byId.get(row.id);
  if (!item) continue;
  const artDir = path.join("/workspace/artifacts/stack-pr", item.id);
  fs.mkdirSync(artDir, { recursive: true });
  const body = [
    item.title,
    "",
    "## 概要",
    "",
    `- 系列: **${item.series}**`,
    `- スタック親: \`${row.base}\``,
    `- ブランチ: \`${row.branch}\``,
    item.series.startsWith("B") || item.series.startsWith("C")
      ? "- 目標 UI: `dashboard-research/mockups-m3e-v3/`（リポジトリ外の参考モック）"
      : "- 元: uploads 0001–0009 を 1PR=1変更に分解",
    "",
    "## スクリーンショット（before / after）",
    "",
    "デモ版（`pnpm --filter @mf100/web build:demo`）で `node scripts/stack-pr/run-one.mjs --from " +
      item.id +
      "` を実行すると `artifacts/stack-pr/" +
      item.id +
      "/` に PNG が出ます。本 PR マージ前に大地さんレビュー用に同コマンドで撮り直してください。",
    "",
    m3eSection({
      refs: (item.m3e ?? ["typography"]).map((k) => M3E_PAGES[k] ?? k),
      aligned: [
        "Expressive のコンポーネント（@m3e/react）の variant / shape をそのまま利用",
        "色は `--mf-*` トークン（color roles）からのみ",
      ],
      intentional: ["モック v3 より情報密度を下げたデモデータ（別 PR で足す）"],
    }),
    "",
    decideSection(item.decide),
    "",
    "## 衝突メモ",
    "",
    "- PR #86 `cursor/transfer-work-creators-c30a` が `WorksTable.tsx` を変更。衝突時は #86 を先に取り込む。",
    "",
    "## テスト",
    "",
    "- `pnpm check` / `pnpm typecheck` / `pnpm test`",
    item.verify === "standard"
      ? "- smoke E2E: `CHROMIUM_PATH=/usr/bin/google-chrome pnpm --filter @mf100/web e2e:smoke`（クラウド VM では playwright パスに注意）"
      : "- 上記 + 該当 spec",
    "",
    "トラッキング一覧: `docs/STACK_PR_TRACKING.md`",
  ].join("\n");
  fs.writeFileSync(path.join(artDir, "pr-body.md"), body);
}
console.log("wrote", rows.length, "bodies");
