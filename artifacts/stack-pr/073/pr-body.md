ui(home): ロール名なしのビュー切替

## 概要

- 系列: **B-dashboard**
- スタック親: `cursor/stack-072-demo-dashboard-role-homes-8b5a`
- ブランチ: `cursor/stack-073-ui-home-view-switcher-8b5a`
- 目標 UI: `dashboard-research/mockups-m3e-v3/`（リポジトリ外の参考モック）

## スクリーンショット（before / after）

デモ版（`pnpm --filter @mf100/web build:demo`）で `node scripts/stack-pr/run-one.mjs --from 073` を実行すると `artifacts/stack-pr/073/` に PNG が出ます。本 PR マージ前に大地さんレビュー用に同コマンドで撮り直してください。

## Material 3 Expressive 自己レビュー

### 参照した公式ページ

- https://m3.material.io/components/button-groups/overview

### 合っている点

- Expressive のコンポーネント（@m3e/react）の variant / shape をそのまま利用
- 色は `--mf-*` トークン（color roles）からのみ

### 意図的に外した点

- モック v3 より情報密度を下げたデモデータ（別 PR で足す）

## 決めること

38A. ロール別ホーム

- ★ A) 画面上にロール名を出さない — decisions 38A

## 衝突メモ

- PR #86 `cursor/transfer-work-creators-c30a` が `WorksTable.tsx` を変更。衝突時は #86 を先に取り込む。

## テスト

- `pnpm check` / `pnpm typecheck` / `pnpm test`
- smoke E2E: `CHROMIUM_PATH=/usr/bin/google-chrome pnpm --filter @mf100/web e2e:smoke`（クラウド VM では playwright パスに注意）

トラッキング一覧: `docs/STACK_PR_TRACKING.md`
