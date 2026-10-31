ui(detail): 詳細画面ルートと 2 行見出し

## 概要

- 系列: **C-detail**
- スタック親: `cursor/stack-073-ui-home-view-switcher-8b5a`
- ブランチ: `cursor/stack-074-detail-route-shell-8b5a`
- 目標 UI: `dashboard-research/mockups-m3e-v3/`（リポジトリ外の参考モック）

## スクリーンショット（before / after）

デモ版（`pnpm --filter @mf100/web build:demo`）で `node scripts/stack-pr/run-one.mjs --from 074` を実行すると `artifacts/stack-pr/074/` に PNG が出ます。本 PR マージ前に大地さんレビュー用に同コマンドで撮り直してください。

## Material 3 Expressive 自己レビュー

### 参照した公式ページ

- https://m3.material.io/styles/typography/overview
- https://m3.material.io/styles/shape/overview

### 合っている点

- Expressive のコンポーネント（@m3e/react）の variant / shape をそのまま利用
- 色は `--mf-*` トークン（color roles）からのみ

### 意図的に外した点

- モック v3 より情報密度を下げたデモデータ（別 PR で足す）

## 決めること

59A. 詳細画面作り直し

- ★ A) 初版から — decisions 59A

## 衝突メモ

- PR #86 `cursor/transfer-work-creators-c30a` が `WorksTable.tsx` を変更。衝突時は #86 を先に取り込む。

## テスト

- `pnpm check` / `pnpm typecheck` / `pnpm test`
- smoke E2E: `CHROMIUM_PATH=/usr/bin/google-chrome pnpm --filter @mf100/web e2e:smoke`（クラウド VM では playwright パスに注意）

## スタック一覧（001–074）

| #       | 系列        | タイトル                                                         | 決めること |
| ------- | ----------- | ---------------------------------------------------------------- | ---------- |
| 001     | A-ui-copy   | copy(labels): 採否を「反映する／反映しない／次の版で対応」に統一 | あり       |
| 002     | A-ui-copy   | copy(labels): 版の状態を「校正中／締切済み」に統一               | あり       |
| 003     | A-ui-copy   | copy(labels): 重要度 info を「参考」に                           | あり       |
| 004     | A-ui-copy   | copy(labels): 校了操作を「校了する／未対応のまま校了」に         | あり       |
| 005     | A-ui-copy   | copy(labels): コメント不可理由を短く                             | なし       |
| 006     | A-ui-copy   | copy(labels): 通知種別ラベルを短く・用語統一                     | あり       |
| 007     | A-ui-copy   | copy(labels): 権限「編集（制作委任）」→「編集」                  | なし       |
| 008     | A-ui-copy   | copy(errors): 利用者向けエラーメッセージの短縮・用語統一         | なし       |
| 009     | A-ui-copy   | copy(errors): errors.test を新文言に合わせる                     | なし       |
| 010     | A-ui-copy   | copy(errors): failureText テストを新文言に合わせる               | なし       |
| 011–057 | A-ui-copy   | copy: 各ファイルの文言短縮・用語統一（1 ファイル = 1 PR）        | なし       |
| 058     | A-ui-copy   | review: 選んだコメントのパネルにだけ反映ボタン行を出す           | あり       |
| 059     | A-ui-copy   | review: 一覧カードは小さな状態表示のみ                           | なし       |
| 060     | A-ui-copy   | test(e2e): 反映ボタン行に合わせ decision spec を更新             | なし       |
| 061     | A-ui-copy   | editor: ? でショートカット一覧                                   | あり       |
| 062     | A-ui-copy   | copy: 「校正の締切」→「校正期日」                                | なし       |
| 063–064 | A-ui-copy   | style(M3E) / e2e スクリーンショット手順                          | なし       |
| 065–066 | A-ui-copy   | copy(make) / ui(make) 「あなたの番」撤去                         | なし       |
| 067–068 | A-ui-copy   | style(M3E): segmented list                                       | あり       |
| 069     | B-dashboard | feat(domain): 7 段階 stage ID                                    | あり       |
| 070–072 | B-dashboard | schema 予定日 / danger KPI / demo seed                           | なし       |
| 073     | B-dashboard | ui(home): ロール名なしのビュー切替                               | あり       |
| 074     | C-detail    | ui(detail): 詳細画面ルートと 2 行見出し                          | あり       |

詳細行・ブランチ名: `docs/STACK_PR_TRACKING.md`（リポジトリ正本: `scripts/stack-pr/manifest.json`）
