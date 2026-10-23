# テスト計画（受け入れ条件 A-01〜A-20 との対応）

実行コマンド: `pnpm test`（Vite+ が全プロジェクトの Vitest を実行）。層ごとのテスト:

- `packages/domain/src/__tests__/*.test.ts` — 不変条件（60 件。v1 の専門確認・持越・無効化は `v1.test.ts`）
- `packages/application/src/__tests__/*.test.ts` — ユースケース（インメモリ、38 件。組織権限の拡張点 `org.test.ts`、v1 の通知・リマインド・清掃は `v1.test.ts`）
- `apps/convex/convex/mvp.test.ts` — convex-test による統合（認可・状態遷移、7 シナリオ。「v1」で専門確認→校了ガード、担当者・訂正、持越、無効化、通知、清掃、ユーザー検索を一周）
- `apps/api/src/__tests__/app.test.ts` / `cleanup.test.ts` — Hono（12 件。R2 清掃を含む）
- `apps/web/e2e/pwa.mjs`（`pnpm e2e:pwa`）— PWA（マニフェスト・Service Worker・キャッシュの範囲・オフライン・更新）。詳細は `docs/PWA.md`
- `apps/web/e2e/screenshots.mjs`（`pnpm a11y`）— デモモードで 62 画面を一周し axe-core（WCAG 2.1 A/AA）を実行。結果は `docs/a11y-report.json`
- `apps/web/src/features/upload/submissionFlow.test.ts` — 提出オーケストレーション（4 件）
- 文章エディタ: domain `document.test.ts`（下書きの版番号・上限・文字カウント）、application `documents.test.ts`（権限・競合・進行中のみ）、convex `documents.test.ts`（統合）、web `writing/plainText.test.ts`（本文 ⇔ 平文のオフセット往復）。撮影 39〜47 で、書く→提出→書式付きで範囲指摘→指摘から本文を選ぶ、を実ブラウザで検証

- v2（[`FEATURES_V2.md`](FEATURES_V2.md) §8）: domain `comparison.test`（16）・`notation.test`（32）・`social.test`（5）、application `notation.test`（11）・`autoProofread.test`（3）・`documents.test`（SNS 下書き）、convex `comparisons/notation/proofreading/ai.test`、web `zip.test`、E2E 50〜60（表記ルール・文章エディタの検査・提出時の自動校正・PDF の版比較・SNS 投稿の提出から書き出しまで）。試験用ファイルは `apps/web/e2e/make-compare-fixtures.mjs` / `make-notation-fixtures.mjs` で作る

| ID   | 条件                                             | 自動テスト                                                                                          | 状態                                                                                                                                     |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | 権限の無い Nogiku ユーザーが制作物 ID を直接指定 | application `acl.test` / convex `mvp.test`「A-01 / A-20」/ domain `acl.test`                        | ✅ 一覧・詳細・添付認可・コメントすべて forbidden                                                                                        |
| A-02 | PDF2＋ai1 のうち 1 件失敗                        | application `submissions.test`「A-16 / A-02」/ web `submissionFlow.test` / api `app.test`           | ✅ 確定不可、失敗ファイルと理由を提示、再送後に確定                                                                                      |
| A-03 | 複数倍率・回転・ページ切替                       | domain `anchor.test`（0/90/180/270、倍率 2 通りで往復一致）                                         | ✅ 座標変換は検証済み。デモモードの実ブラウザで PDF 上の矩形描画を確認（[SCREENSHOTS](SCREENSHOTS.md) #8）。倍率・回転の手動確認は未実施 |
| A-04 | 期限 1 秒前／ちょうど／1 秒後                    | domain `revision.test` / application `comments.test` / convex `mvp.test`（fake timers）             | ✅ `now < deadlineAt` のみ成功                                                                                                           |
| A-05 | 期限到来時に未読・未対応あり                     | application `comments.test` / convex `mvp.test`                                                     | ✅ 受付だけ終了、他は不変                                                                                                                |
| A-06 | コメント 1 件投稿                                | application `comments.test`                                                                         | ✅ 確認済み・解決・校了へ遷移しない                                                                                                      |
| A-07 | 不採用                                           | application `comments.test` / convex `mvp.test`                                                     | ✅ 理由・判断者・日時・原文が残る                                                                                                        |
| A-08 | 重大未解決で校了                                 | domain `approval.test` / application `approvals.test` / convex `mvp.test`                           | ✅ 通常拒否、理由付き例外は監査付きで可。v1: 専門確認の未完了も同様にブロック（`v1.test`）                                               |
| A-09 | 校了後の操作と再開                               | application `approvals.test` / convex `mvp.test`                                                    | ✅                                                                                                                                       |
| A-10 | 同一リクエスト再送                               | application `submissions/comments/approvals.test` / convex `mvp.test` / web `submissionFlow.test`   | ✅ 二重版・二重校了・二重投稿なし。**通知は未実装のため「二重通知なし」は対象外**                                                        |
| A-11 | ACL 解除後                                       | application `acl.test` / convex `mvp.test` / api `app.test`（配信 403）                             | ✅ 署名 URL を発行しないため即時に効く                                                                                                   |
| A-12 | Figma / frame.io URL 登録                        | application `submissions.test`（external item）/ web ワークスペース UI で「同期していない」旨を明示 | ✅ 外部リンクの保存はテスト済み。v1 で「合意事項として記録」フォームを追加（デモモードで表示確認）                                       |
| A-13 | 600×6×5×10 負荷                                  | —                                                                                                   | ❌ 未実施。`listMine` は職責＋ACL 由来の ID から読み、全件購読しない設計。p95 は PoC で計測                                              |
| A-14 | バックアップ復元                                 | `scripts/verify-backup.py` / `test_verify_backup.py` / `restore_backup_dryrun.py`（夜間 `backup-verify.yml`）。実 export+R2 の復元は手動（RECOVERY） | ⚠️ 照合と dry-run は自動。実クラウドからの復元は未実施 |
| A-15 | キーボード操作                                   | `pnpm a11y`（axe-core、58 画面）                                                                    | ⚠️ 自動検査の残りは日付ピッカーの 1 件（M3E 内部）。キーボードのみ操作・スクリーンリーダーの実機検証は未実施                             |
| A-16 | 第 2 版のアップロード失敗                        | application / convex                                                                                | ✅ 第 1 版の受付維持                                                                                                                     |
| A-17 | 第 2 版の確定成功                                | application / convex                                                                                | ✅ 同一処理で第 1 版 superseded、第 1 版への新規コメント拒否                                                                             |
| A-18 | 0版 → 第 1 版                                    | domain / application / convex                                                                       | ✅ 0版は別区分、通常版は 1 から、0版の指摘は残る、0版の再提出は可（旧ラフ superseded）、0版からの直接校了は拒否                          |
| A-19 | 管理者の ACL 追加／除外                          | application / convex                                                                                | ✅ 履歴（付与者・取消者・時刻）が残り、一般ユーザーは変更不可                                                                            |
| A-20 | グループ情報が無い環境                           | application / convex                                                                                | ✅ 個人 ACL のみで一周。group 主体は明示的に拒否                                                                                         |

## テストの書き方: 文言を確かめない

利用者の指示（2026-10-17）:「そういう機能に関することのない表記や文言についてはテストから消してほしい。調査して消して」

> **機能に関わらない表記・文言はテストで確かめない（要素・状態・数で確かめる）**

文言を変えただけで CI が落ちないようにするための決まり。E2E・単体テストのどちらにも当てはまる。

- 確かめない: 説明文・ヒント・キャプション・空の状態の文、題名・副題、ボタンの文言、スナックバー・通知の題名と本文の言い回し、アプリ名・説明文。
  - 待つ・確かめるときは、要素が出ること、状態を表すクラスや属性、件数、ロールで見る（例: `.thread--closed`、`.write__status--saved`、進捗の部品が消えたこと、`m3e-icon[name="…"]` の有無）。
  - 理由の文などは「空でない」ことまでにとどめる。
- 確かめてよい（文言そのものが挙動）: 整形関数の出力（締切・日付・時刻・版の呼び名）、表記ルールの出力、パーサ・CSV の列名、どの欄が足りないかを表す検証メッセージ、メンションの解釈、差分の結果、ユーザーが入れた値（題名・本文・名前）の表示。
- 文言を手がかりに操作する locator（`hasText: "版として提出"` など）は、操作を見つけるための手がかりなので残してよい。a11y の名前でしか見つけられない操作も同じ。
- 迷ったら、消すより要素・状態・数の確認へ置き換える。

## E2E の構成（2026-10-22）

- 機能の E2E: `apps/web/e2e/specs/*.spec.ts`（Playwright Test）。1 本 1 つの業務の流れで、前提は spec ごとに自分で用意する（ほかの spec に頼らない）。`@smoke` は PR、全部は main。`pnpm --filter @mf100/web e2e`。
- 画面の撮影と a11y: `apps/web/e2e/screenshots.mjs`（main と手動）。上の表の「画面」「a11y」の欄はこちら。
- 書き方・流す範囲・エージェントの手順は `docs/TESTING_AGENT_POLICY.md`、CI と時間の内訳は `docs/CI_CD.md`。

| 旧 smoke（screenshots.mjs）                 | spec（@smoke）                       |
| ------------------------------------------- | ------------------------------------ |
| 02・02b・02c 制作物一覧の絞り込み・並べ替え | `works-list.spec.ts`                 |
| 03・04・14・71b・05 最初の版の提出          | `submit-revision.spec.ts`            |
| 06・13c・07 校正者の割り当てと「校正」      | `assign-reviewer.spec.ts`            |
| 08 紙面へのコメント                         | `comment.spec.ts`                    |
| 09 採否                                     | `decision.spec.ts`                   |
| 10・11 校了（例外校了含む）                 | `finalize.spec.ts`                   |
| 20c・20e スマホの「校正」                   | `mobile-check.spec.ts`（@core）      |
| 01・21・22・29・31・31b・31c・15・71 など   | 撮影だけ（`screenshots.mjs` に残す） |

@core に残す主要な流れ: 17 持ち越し `carry-forward`、25 比較 `compare`、18・32 通知 `notifications`、スマホ `mobile-check`。

## 未実施・手動確認が必要なもの

**優先**: E2E を増やすより先に、3 の A-13（負荷）と A-14（バックアップからの復元）。本番運用での影響が大きく、いまは自動の検証が無い（`docs/TESTING_AGENT_POLICY.md`）。

1. 実 Convex deployment・実 Nogiku Auth との接続（本セッションはクラウド未接続。モック provider と convex-test で代替）
2. 実 Convex / Hono 経由でのブラウザ動作（デモモードでは M3E 表示・PDF.js 描画・ドラッグ位置指定を確認済み）
3. A-13 負荷、A-14 復元、A-15 の実機（キーボードのみ・スクリーンリーダー）確認
4. R2 清掃 cron の実機（`wrangler dev --test-scheduled`）
5. Workers 実機での R2 sha256 検証と大容量（D15）
