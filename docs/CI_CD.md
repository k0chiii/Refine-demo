# CI/CD

GitHub Actions で回す。設定は `.github/workflows/`。

## CI（`ci.yml`）

PR と `main` への push で走る。手で起動することもできる（手動は main と同じジョブ）。テストの方針は `docs/TESTING_AGENT_POLICY.md`。

| ジョブ       | いつ       | 内容                                                                                                                                                                                                                                                                                                          |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`     | PR・main   | `pnpm build`（TanStack Router のルートの型 `routeTree.gen.ts` もここで作る。コミットしないので、無いと lint の型検査が落ちる）→ `pnpm check`（整形・lint）→ `pnpm typecheck`（web は spec の型も）→ `pnpm test`。`pnpm codegen` をやり直して、コミットした `convex/_generated` と食い違っていないかも確かめる |
| `e2e-smoke`  | PR         | デモ版を建てて、機能の E2E（Playwright Test の `@smoke`）と `e2e/pwa.mjs`。失敗したときだけ HTML の報告と trace を成果物に残す                                                                                                                                                                                |
| `e2e`        | main・手動 | 機能の E2E（`e2e/specs` の全部）を 2 つの shard に分けて同時に。報告は blob で残す                                                                                                                                                                                                                            |
| `e2e-report` | main・手動 | shard の blob を `playwright merge-reports` で 1 つの HTML 報告（失敗の trace 入り）にまとめて成果物に                                                                                                                                                                                                        |
| `visual`     | main・手動 | `e2e/screenshots.mjs` で画面の撮影・操作の検証・a11y（axe）を部（core・compact・v2・web）ごとに。web の部では PWA も。撮った画面・a11y の結果・区間計測（`timings-<部>.json`）は成果物（14 日）に残し、リポジトリには入れない。区間計測の遅い順は実行のまとめ（Summary）にも出る                              |

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

| 実行           | 直す前（2026-10-22 の main・PR）                                                       | 直した後 |
| -------------- | -------------------------------------------------------------------------------------- | -------- |
| PR             | 5 分 05 秒（Smoke E2E 5 分 05 秒・verify 2 分 12 秒）                                  | 未計測   |
| main への push | 12 分 30 秒（E2E core 12 分 26 秒・v2 6 分 54 秒・compact 5 分 41 秒・web 2 分 47 秒） | 未計測   |

目標（PR は 3 分 30 秒以内、main は 6 分以内）はどちらも達成（PR #35 の実行 39766175645・手動の実行 39766186452）。PR の律速は verify の型（48 秒）と単体テスト（51 秒）になった。

残っている時間の大きいもの（次に手を入れるなら）:

- v2 の操作の多くは自動校正（ブラウザ内の OCR）を待つ時間。撮影が要らない検証は spec に移し、OCR を待たない前提（自動校正の結果を前提づくりで入れる）にできる。
- core の axe は 25 秒（1 画面 0.4 秒）。全画面ではなく、画面の種類ごとに 1 回にできる。
- `screenshots.mjs` の固定待ち（`waitForTimeout`、29 か所。v2 で 17 秒）。長押しの再現など意図があるものを除いて、状態を待つ形に置き換えられる。

## CD（`deploy.yml`）

| 先                     | いつ                                                                                                                                                                                                | 必要な設定                                                                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| デモ版（実データなし） | `main` に入ったら Cloudflare Pages の本番（`mf100-refine-demo`）、PR ごとにブランチのプレビュー。Secrets が無いあいだは配らずに飛ばす（失敗にはしない）                                             | リポジトリの Secrets: `CLOUDFLARE_API_TOKEN`（Pages の編集権限）・`CLOUDFLARE_ACCOUNT_ID`。Pages のプロジェクト `mf100-refine-demo` を一度だけ作っておく                                                                                                                                                       |
| 本番                   | **自動では走らない**。Actions の「Deploy」を手で起動し、配る先に `production` を選ぶ。さらに Environment `production` の承認者が承認してから進む（CLAUDE.md「本番デプロイは明示承認まで行わない」） | Environment `production`（承認者を設定）に Secrets: `CONVEX_DEPLOY_KEY`（Convex の Production deploy key）・`CLOUDFLARE_API_TOKEN`（Workers・Pages・R2）・`CLOUDFLARE_ACCOUNT_ID`、Variables: `VITE_API_URL`（Workers の URL）。Pages のプロジェクト `mf100-refine`、R2 バケット `mf100-assets` を一度だけ作る |

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
