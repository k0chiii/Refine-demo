# CI/CD

GitHub Actions で回す。設定は `.github/workflows/`。

## ブランチ（`main ← develop ← feat-*`）

| ブランチ  | 役割             | PR の向き                      | 配布                                  |
| --------- | ---------------- | ------------------------------ | ------------------------------------- |
| `feat-*`  | 機能・修正の作業 | → `develop`                    | なし（CI のみ）                       |
| `develop` | 統合。デモの正   | ← feat、→ `main` へ昇格        | デモ Pages（`mf100-refine-demo`）     |
| `main`    | 本番の正         | ← `develop` のみ（運用で守る） | 本番（Convex / Workers / Pages 本番） |

GitHub の Settings › Branches / Rulesets で、`develop` と `main` に PR 必須・`verify` 必須を置く。`main` への PR の base は `develop` に限る運用にする（Rulesets の制限は利用者が設定する）。

## CI（`ci.yml`）

PR と `main` / `develop` への push で走る。手で起動することもできる（手動は push と同じジョブ）。テストの方針は `docs/TESTING_AGENT_POLICY.md`。

| ジョブ                                                                 | いつ                | 内容                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-check` / `verify-typecheck` / `verify-test` / `verify-codegen` | PR・main・develop   | 並列。各ジョブが `pnpm build` のあと、整形 lint・型（＋ Worker 型とバックアップ照合単体）・単体テスト・codegen 差分のどれかを流す。PR の単体は `pnpm test`、push / 手動は `pnpm test:coverage`（成果物）。task-cache の鍵に `event_name` は入れない |
| `verify`                                                               | PR・main・develop   | 上 4 レーンの集約。必須チェック名を `verify` のままにするためのジョブ                                                                                                                                                                               |
| `e2e-smoke`                                                            | PR                  | ジョブ内でデモ版をビルドしてから `@smoke` と `e2e/pwa.mjs`。失敗時だけ HTML 報告と trace                                                                                                                                                            |
| `e2e`                                                                  | main・develop・手動 | ジョブ内でデモ版をビルドしてから全 spec（1 ジョブ・Playwright 並列。shard は使わない）。HTML 報告を成果物に                                                                                                                                         |
| `visual`                                                               | main・develop・手動 | ジョブ内でデモ版をビルドしてから `e2e/screenshots.mjs`（部ごと）。a11y は serious / critical で落とす（日付ピッカーの既知違反は除外）。振る舞いの失敗は最後にまとめて落とす。撮った画面は成果物のみ                                                 |

ブラウザは runner に入っている Chrome（`/usr/bin/google-chrome`）を使い、Playwright のブラウザは落とさない（`CHROMIUM_PATH`）。

### 時間の内訳と見直し（2026-10-22）

e-dash の記事（CI を 18 分 → 4 分台）に倣い、まず時間を分けて測った。記事で効いた Vitest のワーカー・DB の初期化のキャッシュ・node_modules のキャッシュは、ここでは効かない（依存の導入は 9 秒、デモ版のビルドは 5 秒、単体テストは 15 秒前後）。遅いのは E2E の中身だけだった。

`screenshots.mjs` に区間計測（画面ごとの 操作 / 描画待ち / 固定待ち / 撮影 / axe）を入れて測ると、**smoke の 251 秒のうち 232 秒が描画待ち（`settle()`）**だった。`settle()` は「有限の animation が終わるまで（最大 3 秒）」待つが、アプリバーの縁の animation（`mf-appbar-edge`、`animation-timeline: scroll()`）はスクロール連動で時間では終わらず、常に running に見える。そのため**ほぼ毎回 3 秒の打ち切りまで待っていた**。文書の時間軸（`document.timeline`）で動く animation だけを見るように直した。a11y の結果は既存の `docs/a11y-report.json` と重なる全画面で一致（違反は日付ピッカーの 1 件のまま）。

手元（クラウド環境・同じデモ版）での計測:

| 対象                             | 直す前                            | 直した後                                                   |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------- |
| smoke（23 画面）                 | 251 秒（描画待ち 232 秒）         | 35 秒（描画待ち 17 秒）                                    |
| core（a11y あり・62 画面）       | CI で 11 分 50 秒（ブラウザの段） | 124 秒（操作 39・描画待ち 49・axe 25・固定待ち 7・撮影 5） |
| compact（a11y あり・25 画面）    | CI で約 5 分                      | 58 秒                                                      |
| v2（a11y あり・24 画面）         | CI で約 6 分                      | 122 秒（操作 68 秒の多くは自動校正・OCR の待ち）           |
| web（a11y あり・8 画面）         | CI で約 2 分                      | 42 秒                                                      |
| 機能の E2E（spec 15 本・4 並列） | —                                 | 約 50 秒（`--repeat-each=2` の 30 本で 1 分 44 秒）        |

CI の壁時計（GitHub Actions）:

| 実行                  | 直す前（2026-10-22 の main・PR）                                                       | 直した後                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR                    | 5 分 05 秒（Smoke E2E 5 分 05 秒・verify 2 分 12 秒）                                  | **2 分 34 秒**（verify 2 分 32 秒・e2e-smoke 1 分 50 秒。律速は verify）                                                                                               |
| main 相当（手動起動） | 12 分 30 秒（E2E core 12 分 26 秒・v2 6 分 54 秒・compact 5 分 41 秒・web 2 分 47 秒） | **2 分 46 秒**（visual: v2 2 分 42 秒・core 2 分 33 秒・compact 1 分 48 秒・web 1 分 18 秒、e2e: 1/2 1 分 53 秒・2/2 1 分 40 秒、e2e-report 30 秒、verify 2 分 28 秒） |

目標（PR は 3 分 30 秒以内、main は 6 分以内）はどちらも達成（PR #35 の実行 39766175645・手動の実行 39766186452）。PR の律速は verify の型（48 秒）と単体テスト（51 秒）になった。

2026-10-23 の見直し（実装）:

- `verify` を並列レーン＋集約に分けた。PR の律速だった直列の型＋単体を同時に流す。
- PR では coverage を取らない。main だけ `test:coverage`。
- `build-demo` 成果物ジョブをやめ、e2e / visual が各自でデモ版をビルドする（直列の固定費を外す）。
- e2e の shard をやめ、1 ジョブにまとめた（偏りと二重の setup を避ける）。
- `screenshots.mjs` は確認（`expectTrue`）が外れても止まらず、最後まで撮ってから外れた確認を全部並べて失敗にする。操作そのものが落ちたとき（要素が出ない等）はその場で止まる。
- a11y（`A11Y=1`）は serious / critical の違反があれば実行を失敗にする。除外は既知の 1 件だけ（日付ピッカー `21-date-picker` の `aria-command-name`。M3E の `m3e-calendar` / `m3e-month-view` の中。`a11yKnown`）。違反の一覧は従来どおり `a11y-report*.json` に書く。
- 自動校正（OCR）の待ちの長い猶予（90 秒）は 1 回の実行で 1 度だけ。2 度目（`all` の 54。別の版）は 60 秒で打ち切る。部ごとに流す CI では各部 1 度しか待たない。
- spec と重なる振る舞いの確認（制作物一覧の絞り込み・並べ替え、割り当てのグループ、校正の切り替え・ナビ）は `screenshots.mjs` から外し、撮影だけ残した。校了・採否の spec は `@smoke` に上げ、PR で走る。
- 壁時計の表（上）は 0103e17 前後の旧計測のまま。新しい壁時計は次の PR / main 実行で測り直す。

## CD（`deploy.yml`）

| 先                     | いつ                                                                                                                                                                                                                                                       | 必要な設定                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| デモ版（実データなし） | **`develop` への push** で CI 完了後、集約ジョブ `verify` が success なら配る（e2e / visual の成否は問わない）。手動のデモ配布も同じ門。Secrets が無いあいだは配らずに飛ばす                                                                               | リポジトリの Secrets: `CLOUDFLARE_API_TOKEN`（Pages の編集権限）・`CLOUDFLARE_ACCOUNT_ID`。Pages のプロジェクト `mf100-refine-demo` を一度だけ作っておく                                     |
| 本番                   | **`main` への push**（通常は develop→main の merge）で CI 完了後、`verify` が success なら配る。Environment `production` に承認者を置けば配布前に止まる。手動 `workflow_dispatch`（`target: production`）も可。`seed_notation` / `fb_migration` は手動のみ | Environment `production` に Secrets: `CONVEX_DEPLOY_KEY`・`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`、Variables: `VITE_API_URL`。Pages `mf100-refine`、R2 `mf100-assets` を一度だけ作る |

## バックアップ照合（`backup-verify.yml`）

夜間と手動で `scripts/test_verify_backup.py` と `scripts/restore_backup_dryrun.py` を流す（A-14 の自動側。fixture のみ。実 export / 実 R2 の復元は RECOVERY.md）。

本番の順番: 型・単体テスト → `convex deploy`（Convex を配り、その URL を `VITE_CONVEX_URL` にして Web をビルド）→ `wrangler deploy --env production`（Workers）→ `wrangler pages deploy`（Web）。Convex の環境変数（Nogiku・`MF100_UPLOAD_SECRET`・`MF100_CLEANUP_SECRET` など）と Workers の秘密（`wrangler secret put --env production` で `MF100_UPLOAD_SECRET`・`MF100_CLEANUP_SECRET`。Convex と同じ値、16 文字以上）は README の表のとおり先に設定する。Workers の本番の `vars`（`CONVEX_URL`・`CONVEX_SITE_URL`・`ALLOWED_ORIGINS`）は `apps/api/wrangler.jsonc` の `env.production` に書く（ダッシュボードで変えても deploy で上書きされる）。`MF100_UPLOAD_SECRET` が無いと本番でファイルを提出できない。

トークンや鍵はチャットやリポジトリに書かず、GitHub の Settings › Secrets and variables（本番は Settings › Environments › production）に入れる。

## 表記ルールの初期データ（2026-10-18）

- Deploy を手で起動するとき、`target: production` と一緒に `seed_notation` を入れると、Convex を配った直後に `convex run notationSeed:importSamples` を流す。
- 入るのはデモ版と同じ表記ルール（`apps/convex/convex/lib/notationSamples.ts`）。同じ ruleId があれば飛ばすので、何度流しても増えない。記録上の実行者は最初のシステム管理者（いなければ失敗する）。

## FB のコメントへの移行（2026-10-20）

FB（フィードバック）を廃止してコメントへ移した（docs/UI_M3E.md §95）。本番のデータは、Deploy を手で起動して `target: production` と一緒に入力 `fb_migration` を選んで移す。配り終えてから、Convex の内部関数 `feedbackMigration:run` をデプロイキー（`CONVEX_DEPLOY_KEY`）で `convex run` し、返ったまとめ（JSON）を実行の Summary に出す。

1. `dry-run`: 何も書かず、移すスレッド・返信・添付・既読の数、未解決／解決済みの数、版が無くて移さない数、制作物ごとの上位 20 を数える。
2. `migrate`: コメントへ移す。何度流しても増えない（移行済みは飛ばす）。
3. `delete`: 全て移行済みであることを確かめてから、FB の行を全て消す。移っていないスレッドがあれば何も消さず `refused: true` を返す。R2 の実体には触れない。

`none`（既定）は何も流さない。順番は dry-run → 件数を確かめる → migrate → 画面で確かめる → delete。FB の表は、delete を流し終えた後の変更で schema から落とす。

## 基盤の追加改善

- Node は CI/CD とも `.node-version` を使う。Vite+ と pnpm は lockfile / packageManager の版を使い、最新版へ無条件で migrate しない。
- `pnpm check` は `verify-static` タスクの依存として Web build と Convex codegen を先に実行する。`pnpm typecheck` も生成物の依存を明示する。型対応 lint と tsc は完全互換とは判断せず、Convex・Web・E2E の tsc を残す。
- `bundle-web`・`bundle-demo`・`verify-types`・`generate-convex` は決定的なタスクとしてキャッシュする。接続先の VITE 変数、lockfile、共有ソース、設定を fingerprint し、routeTree・OCR・dist と生成 API を復元する。サービス・テスト・デプロイはキャッシュしない。
- Vite task-cache は Actions の `actions/cache` で commit をまたいで残す。鍵に `event_name` は入れない。デモ版の dist をジョブ間で転送しない（各 e2e / visual ジョブが `build:demo` する）。
- 任意の commit hook は `pnpm exec vp hooks enable` で有効化できる。`.vite-hooks/pre-commit` は `pnpm staged` の読み取り専用検査を実行し、ステージ外の変更を自動修正・取り込みしない。通常の CI は引き続き全体を検査する。
- 対象別単体テストは `pnpm test:domain` / `test:application` / `test:convex` / `test:api` / `test:web`。E2E と PWA は別に実行する。
- `pnpm --filter @mf100/api types` で Wrangler の環境・compatibility date/flags に対応する型を生成する。`types:check` は一時ファイルと比較し、追跡ファイルを書き換えない。
- ファイル API は従来の `wrangler dev` に加えて `pnpm --filter @mf100/api dev:vite` / `build:worker` / `preview:worker` を使える。R2 はローカル。cron は従来どおり `wrangler dev --test-scheduled` でも確認できる。Cloudflare plugin の生成設定に引きずられないよう、配信と型生成では `--config wrangler.jsonc` を明示する。

### 固定 staging（手動のみ）

`.github/workflows/staging.yml` は GitHub environment `staging` の独立した鍵と URL を使う。production の値を複製して動かさない。Cloudflare の R2 `mf100-assets-staging`、Worker `mf100-api-staging`、Pages `mf100-refine-staging` を事前に管理者が用意する。

必要な Variables: `STAGING_CONVEX_URL`、`STAGING_CONVEX_SITE_URL`、`STAGING_ALLOWED_ORIGINS`（staging Web の HTTPS origin）、`STAGING_API_URL`。
Secrets は staging 専用 `CONVEX_DEPLOY_KEY`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。Convex の `CONVEX_SITE_ORIGIN` とキーの対象を読み取りで照合してから配信する。Nogiku mock/redirect、共有 upload secret、CORS を staging ごとに設定し、本番データを取り込まない。

`apps/api` の `pnpm deploy staging` は未設定・本番の URL を拒否する。staging 用設定の loopback URL はローカル用の無効な初期値であり、配信には上記の変数が必須。Cloudflare Access を使う場合は `ACCESS_TEAM`（team slug）と `ACCESS_AUDIENCE` を両方設定する。Access JWT の issuer/audience/署名を確認した後も、アプリの JWT と作品 ACL を確認する。公開デモには設定しない。

実クラウドでの staging 配信・SSO・R2 と Convex の連携は、専用資源と鍵を設定した後の検証が必要。このリポジトリ内のデモ E2E の成功はその代わりにならない。復旧と配信版 ID は [RECOVERY.md](RECOVERY.md) を参照。
