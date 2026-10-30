#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { M3E_PAGES, m3eSection, decideSection } from "./m3e-snippets.mjs";

const stackDir = path.join("/workspace/scripts/stack-pr");
const manifest = JSON.parse(fs.readFileSync(path.join(stackDir, "manifest.json"), "utf8"));
const rows = JSON.parse(fs.readFileSync(path.join(stackDir, "published-branches.json"), "utf8"));
const byId = new Map(manifest.map((m) => [m.id, m]));
const fixtures = path.join(stackDir, "fixtures");
/** PR 本文用: GitHub raw（ブランチに PNG を commit したうえで参照） */
const RAW_SCREENSHOT_BASE =
  process.env.STACK_PR_RAW_BASE ??
  "https://raw.githubusercontent.com/k0chiii/Refine-demo/cursor/stack-docs-stack-pr-tracking-8b5a/docs/stack-pr-screenshots";

function shotSection(id, item) {
  const artDir = path.join("/workspace/artifacts/stack-pr", id);
  const lines = ["## スクリーンショット（before / after）", ""];
  const beforeD = path.join(artDir, "before-desktop.png");
  const afterD = path.join(artDir, "after-desktop.png");
  const afterM = path.join(artDir, "after-mobile.png");
  const fix058d = path.join(fixtures, "x3-focused-comment.png");
  const fix058m = path.join(fixtures, "x3b-mobile-focused-comment.png");
  const raw058d = `${RAW_SCREENSHOT_BASE}/058/x3-focused-comment.png`;
  const raw058m = `${RAW_SCREENSHOT_BASE}/058/x3b-mobile-focused-comment.png`;

  if ((id === "058" || id === "060") && fs.existsSync(fix058d)) {
    lines.push("### After（デスクトップ・選択中コメント / x3）");
    lines.push(`<img alt="after desktop x3" src="${raw058d}" />`);
    lines.push("");
    if (fs.existsSync(fix058m)) {
      lines.push("### After（412px / x3b）");
      lines.push(`<img alt="after mobile x3b" src="${raw058m}" />`);
      lines.push("");
    }
  }

  if (fs.existsSync(beforeD)) {
    lines.push("### Before");
    lines.push(
      `<img alt="before desktop" src="${RAW_SCREENSHOT_BASE}/${id}/before-desktop.png" />`,
    );
    lines.push("");
  }
  if (fs.existsSync(afterD) && id !== "058" && id !== "060") {
    lines.push("### After");
    lines.push(`<img alt="after desktop" src="${RAW_SCREENSHOT_BASE}/${id}/after-desktop.png" />`);
    lines.push("");
  }
  if (fs.existsSync(afterM) && item.shots?.mobile && id !== "060") {
    lines.push("### After（モバイル）");
    lines.push(`<img alt="after mobile" src="${RAW_SCREENSHOT_BASE}/${id}/after-mobile.png" />`);
    lines.push("");
  }
  if (lines.length <= 2) {
    lines.push(
      "`node scripts/stack-pr/capture-published.mjs " +
        id +
        "` で `artifacts/stack-pr/" +
        id +
        "/` に PNG を生成。",
    );
  }
  return lines.join("\n");
}

for (const row of rows) {
  const item = byId.get(row.id);
  if (!item) continue;
  const artDir = path.join("/workspace/artifacts/stack-pr", item.id);
  fs.mkdirSync(artDir, { recursive: true });

  if (item.id === "058" || item.id === "060") {
    for (const [src, dest] of [
      [path.join(fixtures, "x3-focused-comment.png"), path.join(artDir, "after-desktop.png")],
      [path.join(fixtures, "x3b-mobile-focused-comment.png"), path.join(artDir, "after-mobile.png")],
    ]) {
      if (item.id === "060") continue;
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    }
    if (item.id === "060" && fs.existsSync(path.join(fixtures, "x3-focused-comment.png"))) {
      fs.copyFileSync(
        path.join(fixtures, "x3-focused-comment.png"),
        path.join(artDir, "after-desktop.png"),
      );
    }
  }

  const body = [
    item.title,
    "",
    "## 概要",
    "",
    `- 系列: **${item.series}**`,
    `- スタック親: \`${row.base}\``,
    `- ブランチ: \`${row.branch}\`${row.variant === "v2" ? "（v2・旧 `-8b5a` ブランチは未使用）" : ""}`,
    item.series.startsWith("B") || item.series.startsWith("C")
      ? "- 目標 UI: `dashboard-research/mockups-m3e-v3/`"
      : "- 元: uploads 0001–0009 分解 + ce0b91f/44dba54 参考",
    "",
    shotSection(item.id, item),
    "",
    m3eSection({
      refs: (item.m3e ?? ["typography"]).map((k) => M3E_PAGES[k] ?? k),
      aligned: [
        "Expressive のコンポーネント（@m3e/react）の variant / shape をそのまま利用",
        "色は `--mf-*` トークン（color roles）からのみ",
        item.id === "058" ? "採否行は M3 button groups + filled/tonal/text（https://m3.material.io/components/button-groups/overview）" : null,
        item.id === "058" ? "一覧の出現は motion spatial-fast + reduced-motion で無効化" : null,
      ].filter(Boolean),
      intentional: ["モック v3 より情報密度を下げたデモデータ（別 PR で足す）"],
    }),
    "",
    decideSection(item.decide),
    "",
    "## 衝突メモ",
    "",
    "- PR #86 `cursor/transfer-work-creators-c30a` — WorksTable。取り込み順に注意。",
    "",
    "## テスト",
    "",
    "- `pnpm check` / `pnpm typecheck` / `pnpm test`",
    item.verify === "standard" || !item.verify
      ? "- smoke E2E: `CHROMIUM_PATH=/usr/bin/google-chrome pnpm --filter @mf100/web e2e:smoke`"
      : "- 上記 + `pnpm --filter @mf100/web e2e:smoke`",
    "",
    "トラッキング: `docs/STACK_PR_TRACKING.md`（全一覧は最下位 PR 本文）",
  ].join("\n");
  fs.writeFileSync(path.join(artDir, "pr-body.md"), body);
}
console.log("wrote", rows.length, "bodies");
