# 基盤改善の実装状況

対象: `research/platform-utilization/analysis.md`（main の d00e02f）。P1〜P3 の候補についてコードと設定を追加した。下表は実装範囲と、有効化・実接続の未検証事項を区別する。実クラウドへの配信・課金・実データ移行・復元は実行していない。

## Vite+

| ID  | 状況       | 対応                                                                                                                                                            |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V01 | 実装       | build・demo build・typecheck・codegen の明示タスク。URL・共有ソース・設定・lockfile を fingerprint、生成物を保存・復元。外部状態を変える処理は対象外            |
| V02 | 実装       | codegen → Web build → Web/E2E 型検査・静的検査の dependsOn。task/script 名を分離                                                                                |
| V03 | 実装       | CI の task cache を OS/arch/event/lockfile/Node で分離。デモ成果物を一度 build し E2E/visual が同じ SHA の artifact を取得。実 Actions の時間比較は配信後に確認 |
| V04 | 実装・維持 | 生成順序と型検査のタスクグラフを一本化。型対応 lint を tsc と同一視せず、Convex・Web・E2E の検査は維持                                                          |
| V05 | 実装       | setup-vp v1.9.0 の commit SHA と Vite+ 1.2.0 を固定。Node は .node-version、pnpm は packageManager。toolchain:check で bundled Vitest と override を照合        |
| V06 | 実装       | staged の読み取り専用検査と任意の pre-commit hook。ステージ外の自動修正なし                                                                                     |
| V07 | 実装       | API の Cloudflare Vite plugin 開発・build・preview。従来 Wrangler / cron の経路も維持                                                                           |
| V08 | 実装       | project 別 script と coverage-v8 5.0.4。coverage は text/json-summary/lcov、CI artifact に保存。E2E/PWA は独立                                                  |
| V09 | 実装       | 既存 vp pack に加え package:domain で index.mjs・型宣言・独立した exports manifest を生成。workspace はソース参照を維持。公開はしない                           |
| V10 | 実装       | create の既定にローカル package generator、domain/application の雛形。toolchain:migrate と版の照合を用意。実アップグレードは今回実行していない                  |

## Convex

| ID  | 状況               | 対応                                                                                                                                                                                                                |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | 実装               | 提出・執筆候補を workRoles と edit/manage ACL から取得。rolesVersion 未設定行は保守的に読み、移行中も候補を落とさない。書込みと職責同期は同一 transaction                                                           |
| C02 | 実装               | 年度・状態索引、native cursor、ACL で空のページでも継続。制作物一覧・校了済み・他作品の比較候補で全ページを取得してから件数・並べ替え。旧 listMine と dashboard の上限は互換用に残る                                |
| C03 | 実装               | Unicode 1/2-gram を Latin token に符号化した専用 FTS 索引。従来の includes で最終照合し、移行前の行も別 phase の cursor で検索。日本語・複数項目・ACL の回帰テスト                                                  |
| C04 | 実装               | 作品・版・校了宣言の書込みと同じ transaction で要約を更新。Aggregate は年度/状態/機密区分。一般利用者の集計は normal のみ、管理者だけ restricted を含む。移行完了前は ready:false                                   |
| C05 | 実装               | 一覧は要約行と現在/受付中の版を購読し、過去版・校了履歴を毎回読まない。未移行行は互換経路。詳細の既存 query は維持                                                                                                  |
| C06 | 実装               | Rate Limiter による利用者・作品の頻度制限と利用者別の日次文字数枠。認可・機密区分を再確認してから原子的に確保。外部処理失敗でも消費を保持、SDK 自動再試行なし。金額そのものの予算管理ではない                       |
| C07 | 実装               | Workpool による並列数 8・最大 4 回の再試行、送信前の権限再確認、成功/恒久失敗の配送記録、完了ログ。通信断・429・5xx を再試行。send と記録の間の障害は at-least-once。SW は同じ通知 ID の件数加算・再通知を抑止      |
| C08 | 実装               | Migrations の再開可能な workRoles 修復。既存 FB 移行は置換しない。実データの migration は未実行                                                                                                                     |
| C09 | 実装               | ピン留めの optimistic update。デモ側にも immutable な query store、並行 overlay、成功時再取得・失敗時 rollback を実装。提出・校了には適用しない                                                                     |
| C10 | 実装               | Presence の作品ごとの閲覧者表示。本人をサーバーで解決し、heartbeat/list で ACL を確認。複数タブを統合、退出と timeout は component が管理。デモはタブごとの独立 DB のため Presence を起動しない。入力中表示は未追加 |
| C11 | 実装・実接続未検証 | ProseMirror Sync。通常保存を完了して明示切替、各同期で ACL を確認、snapshot と本文を原子的に保存。旧クライアントの上書きを拒否。提出済み版は不変。デモでは無効                                                      |
| C12 | 実装・実接続未検証 | Workflow は保存原稿の版を参照し、同意後の結果を本人限定で 1 時間保存。step は ID/null のみ、AI 呼出しの自動 retry 無し。意味検索は bge-m3/1024 次元、取得後に現行ルール版・作品 ACL・送信方針を再確認               |
| C13 | 運用準備           | 復旧手順と export/R2 の hash 照合ツール・回帰テスト。実クラウドの定期バックアップ確認・隔離先の復元は未実施。管理権限と隔離先が必要                                                                                 |
| C14 | 運用準備           | 専用キー・URL を照合する固定 staging の手動 workflow と資源分離。専用資源・鍵の設定と実接続の受け入れ検証は未実施。PR ごとの一時 deployment は未導入                                                                |

## Cloudflare

| ID  | 状況                 | 対応                                                                                                                                                                                                                                                |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | 実装                 | 開発・staging・本番の Worker/R2 名を分離。deploy script は環境指定必須、staging の未設定・本番 URL を拒否。既存 production 名は維持                                                                                                                 |
| F02 | 実装                 | Wrangler の binding と日付/flags 対応 runtime 型を生成。手書き interface は app 所有の secret/optional 設定だけ。CI は一時出力で差分を確認                                                                                                          |
| F03 | 一部実装             | server 発行 correlation ID、route template/status/時間、R2 の操作別応答時間、Convex HTTP への ID 伝播、upload service/通知完了のログ。URL・token・本文・objectKey は記録しない。管理画面の tracing/sampling/保持期間と外部 API の詳細 span は未確認 |
| F04 | 実装                 | 認証済み主体の hash と操作種別をキーにする近似 rate limit。転送と Figma に 30 回/60 秒、429 と Retry-After。IP の共有を理由に別人をまとめない。C06 の枠とは別                                                                                       |
| F05 | 実装                 | 8 MiB part、16 MiB 以上の無圧縮提出で multipart。JWT は保存せず sessionStorage の manifest で再開。各 part と完了を認可し、R2 結合後に全体 SHA/サイズを検証。既存の業務上限は維持                                                                   |
| F06 | 実装・実接続未検証   | 任意の platform Worker で Figma を Queue → Workflow に接続。Queue は job ID のみ、再試行でも同じ Workflow ID と write-once の試行キーを使う。R2 event は既知の派生キーと ACL を照合して未起動 Workflow を復旧し、提出の検証済み化には使用しない     |
| F07 | 実装・実接続未検証   | FileWorkflow は認可・変換・採用を最大 3 回の実行で再開。業務状態は Convex processingJobs が正本。失敗/取消後の出力採用を拒否、期限切れと孤立派生物の清掃を追加                                                                                      |
| F08 | 運用準備             | platform-resources.mjs が未完了 multipart の 7 日 abort と temporary/processing/ の 7 日削除を plan として出力。原本・採用済み派生物の経過日数削除はしない。実 lifecycle 設定は未実行                                                               |
| F09 | 実装・実接続未検証   | Images binding の検査と最大幅 1600 の PNG 派生物。20 MB/1 億画素の入力制限。原本を上書きせず、派生の幅/高さを記録。認可付き取得                                                                                                                     |
| F10 | 実装・実接続未検証   | MEDIA binding から非公開 R2 の動画を渡して指定秒の PNG を生成。元動画と時間を変えず別キーに保存。beta 資源との実接続は未検証                                                                                                                        |
| F11 | 実装・実接続未検証   | Stream の署名必須 TUS upload を保存して再開。原本は R2。HLS の manifest/segment を毎要求 ACL 付き proxy で配信し、短命 token をブラウザへ渡さない。hls.js の Authorization loader                                                                   |
| F12 | 実装・実接続未検証   | Browser Run で JS 無効・新規 context・固定 1280x720 の公開ページ画像。main/redirect/subresource に同じ HTTPS host allowlist、IP/資格情報/非公開 host を拒否。スクリーンショットを別キーに保存                                                       |
| F13 | 実装・イメージ未検証 | 外部ネットワーク無効の Container で PDF 先頭ページ/動画フレームを変換。20 MB、30 秒、固定引数、shell/URL 入力なし。変換サーバーをローカル検証。Docker の Debian 取得は環境制限で失敗                                                                |
| F14 | 実装・実接続未検証   | 任意の AI Gateway endpoint を provider adapter へ追加。送り先を検証、本文ログ/キャッシュ/SDK retry は無効、既定は直接 provider。実設定・保持期間の確認と接続検証が必要                                                                              |
| F15 | 実装・実接続未検証   | Workers AI binding を使う private service endpoint と Convex provider。共有秘密・モデル固定・サイズ上限・構造化候補の検証。既存の AI ACL/機密方針/利用枠を共用                                                                                      |
| F16 | 実装・配信未実行     | 任意の STATIC_ASSETS binding、SPA fallback、API prefix の除外。既存 Pages/PWA のヘッダーと配信を維持し、platform-config で選択。ドメイン切替は未実行                                                                                                |
| F17 | 実装・運用準備       | 任意の Access gate。team/issuer/audience/署名を検証し、その後もアプリ JWT と作品 ACL を確認。公開デモは既定で無効。実際の Access アプリの構成は未実施                                                                                               |
| F18 | 実装・運用準備       | 本番 CD に Git SHA・Worker version・Pages deployment の manifest を追加。部分配信の状態を区別し保存。戻せる範囲と前進修正の手順を文書化。実際の配信/rollback は未実施                                                                               |

X01〜X07 は資料の非採用境界を維持する。基盤の全製品を利用するためだけに D1/KV/DO 等へ正本を増やしたり、非公開原本を CDN に公開したりはしない。

## 現在の運用値

- AI: 利用者 6 回/分（burst 2）、作品 12 回/分（burst 3）、利用者 200,000 文字/日。1 回の文字数上限は既存 AI_MAX_CHARS。失敗時も外部呼出し前の確保を戻さず、別ユーザーの消費と混ぜない。金額保証はしない。
- Push: Workpool 最大並列 8、最大 4 attempts、初回 backoff 1 秒、倍率 2。配送記録だけでは送信直後の crash による重複をゼロにできない。
- Presence: heartbeat 30 秒（2026-10-25 に 15 秒から。心拍の mutation を半分に）、room の一覧は最大 100 人。共有は同じ作品の閲覧権限がある相手に限る。
- Gateway: Convex の `AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic` で有効化。本文ログ/キャッシュ禁止の header だけに頼らず、管理画面側の設定も確認する。シークレットは Git/チャットに書かない。

検証結果と実クラウドで未実施の項目は、変更の報告でも区別する。

## 任意機能の有効化

実クラウドの作成・配信・外部送信・移行は行っていない。手順は [PLATFORM_OPERATIONS.md](PLATFORM_OPERATIONS.md)。ソースの設定を有効化したことと、契約済み資源での受入検証を区別する。X01〜X07 の非採用境界は引き続き維持する。

## ローカル検証（2026-10-23 JST）

- 静的検査: 0 errors。既存箇所を含む warnings は 15 件。全パッケージ/Web/E2E の型検査を通過。
- coverage 付き単体・統合テスト: 154 ファイル、1,118 件すべて成功。
- ブラウザ E2E: 15 件すべて成功。PWA の更新・静的キャッシュ・オフライン検査も成功。
- Worker の生成型比較と、任意 binding を含む Worker の dry-run/compile に成功。Container の配備/build を省略するオプションを使用。
- Python: バックアップ照合 2 件、変換サーバー 2 件（実動画から PNG を生成）に成功。package generator と独立した domain bundle の import を確認。
- Container イメージの Debian 依存取得はこの環境で失敗。実クラウドの API/Queue/Workflow/AI/Stream/Access/Static Assets への接続、migration、復元、費用・負荷の確認は未実施。
