# 画面一覧（デモモードで撮影）

`apps/web` の**デモモード**（`pnpm build:demo` → `vp preview --mode demo`、バックエンド無しで Convex の実関数を `convex-test` によりブラウザ内実行）で、Nogiku モック委員 5 名を切り替えながら「登録済み制作物 → 版提出（専門確認の宣言） → 割当 → 指摘 → 専門確認完了 → 採否 → 第2版提出と指摘の持越 → 版比較 → 校了 → 通知」を一周して撮影した（v1 機能を含む）。撮影スクリプト: `apps/web/e2e/screenshots.mjs`（`pnpm screenshots`）。

画面構成は 2026-10-13 の見直し（[`UI_M3E.md`](UI_M3E.md) §11）に従う: **ダッシュボード／制作物／エディタ** の 3 画面＋管理。通知はアプリバーのアカウントの隣のベル（compact でも同じ位置。押すと全画面の通知シート）。制作物に関する操作はすべてエディタの引き出し（コメント／版／情報）で行う。エディタの見出し・戻る・確認完了は共通アプリバーに入り、引き出しの開閉は紙面右端の縦ツールバー（§17）。サイドバーとレイアウトは M3 のウィンドウサイズクラス（§12）: 600 以上はレール（メニュー・FAB「制作物を登録」・行き先。折りたたみ時はアイコンのみ）、599 以下はアプリバー（見出し＋アカウント）＋下部バー。ダッシュボード・制作物・管理の見出しもアプリバーに入る（§18）。検索バーは 2026-10-14 に一旦外した。compact のエディタは共通バーを消し、独自のトップアプリバーと覗き見のボトムシート。

| #   | 画面                                                                              | 役割           | 画像                                           |
| --- | --------------------------------------------------------------------------------- | -------------- | ---------------------------------------------- |
| 1   | サインイン（Nogiku SSO / 開発用モック）                                           | —              | ![](screenshots/01-signin.png)                 |
| 2   | 制作物: 探して開くだけの一覧（登録はレールの FAB）                                | 制作者         | ![](screenshots/02-works-list.png)             |
| 3   | エディタ（版なし）: 最初の版を提出する導線だけ                                    | 制作者         | ![](screenshots/03-editor-empty.png)           |
| 4   | 版提出ダイアログ: 全ファイル検証済み（確定前）                                    | 制作者         | ![](screenshots/04-submit-verified.png)        |
| 5   | 提出確定直後（その版のエディタへ）                                                | 制作者         | ![](screenshots/05-submit-confirmed.png)       |
| 6   | エディタの引き出し「情報」: 基本情報・操作・専門確認（校正者割当後）              | 主管           | ![](screenshots/06-editor-info.png)            |
| 7   | ダッシュボード「あなたの担当 › 校正する」                                         | 校正者         | ![](screenshots/07-dashboard-reviewer.png)     |
| 8   | エディタ: PDF をドラッグしてその場で投稿（コメントを横に一覧）                    | 校正者         | ![](screenshots/08-workspace-comment.png)      |
| 9   | 指摘対応: ⋮ から理由付き不採用、履歴                                              | 制作者         | ![](screenshots/09-decision.png)               |
| 10  | 校了ダイアログ（引き出し「情報」から）                                            | 校了権限者     | ![](screenshots/10-finalize-dialog.png)        |
| 11  | 校了後（校了版・校了履歴・再開）                                                  | 校了権限者     | ![](screenshots/11-work-finalized.png)         |
| 12  | 管理: 作品ごとの閲覧権限（ダイアログ。管理者は内容を閲覧しない: D3）              | システム管理者 | ![](screenshots/12-acl.png)                    |
| 13  | 管理: 閲覧権限のタブ（作品ごとの個人 ACL）                                        | システム管理者 | ![](screenshots/13-admin-works.png)            |
| 13a | 管理: ユーザーのタブ（システム管理者をその場で切り替え）                          | システム管理者 | ![](screenshots/13a-admin-users.png)           |
| 13b | 管理: 監査ログのタブ                                                              | システム管理者 | ![](screenshots/13b-admin-audit.png)           |
| 14  | 版提出: 専門確認の宣言と担当者選択（ダイアログ内）                                | 制作者         | ![](screenshots/14-submit-required-checks.png) |
| 15  | 制作物の編集（引き出し「情報」からのダイアログ）                                  | 主管           | ![](screenshots/15-work-edit.png)              |
| 16  | 専門確認（担当者が確認完了。引き出し「情報」）                                    | 校正者         | ![](screenshots/16-required-check-done.png)    |
| 17  | 第2版: 前版の未解決指摘の持越（人が確認）                                         | 制作者         | ![](screenshots/17-carry-forward.png)          |
| 18  | 通知: アプリバーのベル（規定寸法のバッジ）と幅 360 の浮遊パネル                   | 校正者         | ![](screenshots/18-notifications.png)          |
| 19  | 文章の閲覧と範囲指摘（本文を選択するとその場に投稿欄）                            | 校正者         | ![](screenshots/19-text-range.png)             |
| 20  | compact: ダッシュボード（アプリバーはアカウントだけ、下部バー 3 件）              | 校正者         | ![](screenshots/20-mobile-dashboard.png)       |
| 21  | 日付ピッカー（校正期限は日付のみ・0:00 JST）                                      | 制作者         | ![](screenshots/21-date-picker.png)            |
| 22  | アカウントメニュー（右上の Humation アバター）                                    | 制作者         | ![](screenshots/22-account-menu.png)           |
| 23  | エディタのレイアウト「ピンの高さに並べる」（Google ドキュメント式）               | 校正者         | ![](screenshots/23-layout-aligned.png)         |
| 24  | エディタのレイアウト「ピンだけ」（Figma 式）                                      | 校正者         | ![](screenshots/24-layout-pins.png)            |
| 25  | 版の比較（引き出し「版」の「比較」。新しい版が右、ページ・倍率を共有）            | 制作者         | ![](screenshots/25-compare.png)                |
| 26  | compact: エディタ（独自のトップアプリバー、紙面は幅に合わせ、覗き見のシート）     | 校正者         | ![](screenshots/26-mobile-workspace.png)       |
| 27  | ダッシュボード「あなたの担当 › 返事をする」                                       | 制作者         | ![](screenshots/27-dashboard-creator.png)      |
| 28  | エディタの引き出し「版」: 履歴・開く・比較・提出・無効化                          | 制作者         | ![](screenshots/28-versions.png)               |
| 29  | large（1200 以上）: 標準の展開レール（メニューで開閉、状態を保存）                | 校正者         | ![](screenshots/29-rail-expanded.png)          |
| 30  | expanded（840–1199）: モーダルの展開レール（スクリム、Esc で閉じる）              | 校正者         | ![](screenshots/30-rail-modal.png)             |
| 31  | レールの FAB「制作物を登録」→ 登録ダイアログ                                      | 制作者         | ![](screenshots/31-new-work-fab.png)           |
| 32  | compact: 下部バーの「通知」はモーダルのボトムシート                               | 校正者         | ![](screenshots/32-mobile-notifications.png)   |
| 33  | compact: 制作物一覧（リストは端から端まで、題名と左端 16 で揃う）                 | 校正者         | ![](screenshots/33-mobile-works.png)           |
| 34  | compact: エディタの引き出しを半分まで上げた状態                                   | 校正者         | ![](screenshots/34-mobile-sheet-half.png)      |
| 35  | ドラッグハンドル: スペーサー 24 の中のハンドルで固定ペインを 412 → 360 にスナップ | 校正者         | ![](screenshots/35-pane-drag-handle.png)       |
| 36  | RTL（`dir=rtl`）: レールは先頭端（右）、アプリバー・リストが鏡映                  | 校正者         | ![](screenshots/36-rtl-dashboard.png)          |
| 37  | compact の補助的な選択（添付の切替）はボトムシート                                | 校正者         | ![](screenshots/37-mobile-action-sheet.png)    |
| 38  | 比較しながら新しい版（右）に範囲でコメント（§19）                                 | 校正者         | ![](screenshots/38-compare-comment.png)        |
| 39  | 文章エディタ: 浮遊ツールバー＋A4 の紙面＋補助ペイン「概要」（自動保存）           | 制作者         | ![](screenshots/39-write-editor.png)           |
| 40  | 段落スタイルのメニュー（各スタイルの見た目・ショートカット）                      | 制作者         | ![](screenshots/40-write-style-menu.png)       |
| 41  | 検索と置換（Ctrl+H、補助ペイン。一致を強調）                                      | 制作者         | ![](screenshots/41-write-find.png)             |
| 42  | 文字カウント（選択範囲と文書全体、入力中に表示の切替）                            | 制作者         | ![](screenshots/42-write-word-count.png)       |
| 43  | 提出した文章を校正（書式付きのまま。文字を選ぶとその場に投稿欄）                  | 校正者         | ![](screenshots/43-write-review-select.png)    |
| 44  | 範囲指摘の番号と強調（書式付きの文章）                                            | 校正者         | ![](screenshots/44-write-review-comment.png)   |
| 45  | 指摘を見ながら直す（補助ペイン「指摘」→ 本文の該当箇所を選ぶ）                    | 制作者         | ![](screenshots/45-write-refs.png)             |
| 46  | compact の文章エディタ（下端のドッキングツールバー）                              | 制作者         | ![](screenshots/46-write-compact.png)          |
| 47  | compact の「その他」はボトムシート                                                | 制作者         | ![](screenshots/47-write-compact-more.png)     |
| 50  | 表記ルール: 編集できる表（統一表記・誤表記・カテゴリ・厳格さ・年度・有効）        | システム管理者 | ![](screenshots/50-notation-rules.png)         |
| 50a | 表のセルをその場で編集（Enter で保存・Esc で取消）                                | システム管理者 | ![](screenshots/50a-notation-cell-edit.png)    |
| 50b | 行の詳細（説明・例外・履歴）はダイアログ                                          | システム管理者 | ![](screenshots/50b-notation-rule-detail.png)  |
| 51  | 表記ルール「試す」（端末内の検査。カテゴリの継承）                                | システム管理者 | ![](screenshots/51-notation-try.png)           |
| 52  | 表記ルールの提案（承認・却下・編集して承認・まとめて処理）                        | システム管理者 | ![](screenshots/52-notation-proposals.png)     |
| 53  | 文章エディタの表記の検査（波線と表記パネル）                                      | 制作者         | ![](screenshots/53-write-notation.png)         |
| 54  | 提出時の自動校正（PDF の文字と画像の OCR。「自動校正」のコメント）                | 制作者         | ![](screenshots/54-auto-proofread.png)         |
| 55  | PDF の版比較（ページの自動対応: 旧 5 → 新 6・追加 1、同期と差分）                 | 制作者         | ![](screenshots/55-compare-pdf.png)            |
| 56  | SNS 投稿の編集とプレビュー（Instagram カルーセル・iPhone）                        | 制作者         | ![](screenshots/56-sns-editor.png)             |
| 57  | SNS 投稿のプレビュー: プロフィールのグリッド                                      | 制作者         | ![](screenshots/57-sns-preview-grid.png)       |
| 58  | 校正画面の SNS 投稿プレビュー（校了前は書き出せない）                             | 制作者         | ![](screenshots/58-sns-review.png)             |
| 59  | 校了した SNS 投稿の書き出し（本文のコピー・画像・ZIP）                            | 校了権限者     | ![](screenshots/59-sns-export.png)             |
| 60  | compact: 表記ルール（下部バーに「表記ルール」）                                   | 校了権限者     | ![](screenshots/60-notation-compact.png)       |

`pnpm a11y` で同じ経路に axe-core（WCAG 2.1 A/AA）を流し、`docs/a11y-report.json` に結果を書く（62 画面。残る指摘は M3E calendar 内部の 1 件のみ）。

50〜60 は v2（表記統一・自動校正・高度な版比較・SNS 投稿）。詳細は [`FEATURES_V2.md`](FEATURES_V2.md)。

Material 3 Expressive 適用前の画面は `docs/screenshots-before/`、前後比較と検証は [`UI_M3E.md`](UI_M3E.md)。
