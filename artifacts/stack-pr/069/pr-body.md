feat(domain): 7 段階 stage ID を追加（旧 stage と並行）

## 概要

- 系列: **B-dashboard**
- スタック親: `cursor/stack-068-style-m3e-table-header-segmented-css-8b5a`
- ブランチ: `cursor/stack-069-domain-work-stages-v7-8b5a`
- 目標 UI: `dashboard-research/mockups-m3e-v3/`（リポジトリ外の参考モック）

## スクリーンショット（before / after）

デモ版（`pnpm --filter @mf100/web build:demo`）で `node scripts/stack-pr/run-one.mjs --from 069` を実行すると `artifacts/stack-pr/069/` に PNG が出ます。本 PR マージ前に大地さんレビュー用に同コマンドで撮り直してください。

## Material 3 Expressive 自己レビュー

### 参照した公式ページ

- https://m3.material.io/styles/color/the-color-system/color-roles

### 合っている点

- Expressive のコンポーネント（@m3e/react）の variant / shape をそのまま利用
- 色は `--mf-*` トークン（color roles）からのみ

### 意図的に外した点

- モック v3 より情報密度を下げたデモデータ（別 PR で足す）

## 決めること

Q2. 監査 Q2 状態4つ

- ★ A) 7 段階を新 ID で追加 — データ影響

## 衝突メモ

- PR #86 `cursor/transfer-work-creators-c30a` が `WorksTable.tsx` を変更。衝突時は #86 を先に取り込む。

## テスト

- `pnpm check` / `pnpm typecheck` / `pnpm test`
- 上記 + 該当 spec

トラッキング一覧: `docs/STACK_PR_TRACKING.md`
