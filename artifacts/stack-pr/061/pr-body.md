editor: ? でショートカット一覧

## 概要

- 系列: **A-ui-copy**
- スタック親: `cursor/stack-060-review-e2e-decision-8b5a`
- ブランチ: `cursor/stack-061-editor-shortcut-sheet-8b5a`
- 元: uploads 0001–0009 を 1PR=1変更に分解

## スクリーンショット（before / after）

デモ版（`pnpm --filter @mf100/web build:demo`）で `node scripts/stack-pr/run-one.mjs --from 061` を実行すると `artifacts/stack-pr/061/` に PNG が出ます。本 PR マージ前に大地さんレビュー用に同コマンドで撮り直してください。

## Material 3 Expressive 自己レビュー

### 参照した公式ページ

- https://m3.material.io/components/dialogs/overview
- https://m3.material.io/styles/typography/overview
- https://m3.material.io/components/buttons/overview

### 合っている点

- Expressive のコンポーネント（@m3e/react）の variant / shape をそのまま利用
- 色は `--mf-*` トークン（color roles）からのみ

### 意図的に外した点

- モック v3 より情報密度を下げたデモデータ（別 PR で足す）

## 決めること

2. design-questions #2 コメントボタン
   - ★ A) ツールバー — Figma C

3. design-questions #3
   - ★ A) エディタ内だけ — 58626f5

## 衝突メモ

- PR #86 `cursor/transfer-work-creators-c30a` が `WorksTable.tsx` を変更。衝突時は #86 を先に取り込む。

## テスト

- `pnpm check` / `pnpm typecheck` / `pnpm test`
- smoke E2E: `CHROMIUM_PATH=/usr/bin/google-chrome pnpm --filter @mf100/web e2e:smoke`（クラウド VM では playwright パスに注意）

トラッキング一覧: `docs/STACK_PR_TRACKING.md`
