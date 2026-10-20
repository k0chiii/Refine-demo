# CI/CD

GitHub Actions で回す。設定は `.github/workflows/`。

## CI（`ci.yml`）

PR と `main` への push で走る。手で起動することもできる。

| ジョブ   | 内容                                                                                                                                                                                                                                                                                                                                              | 目安     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `verify` | `pnpm build`（TanStack Router のルートの型 `routeTree.gen.ts` もここで作る。コミットしないので、無いと lint の型検査が落ちる）→ `pnpm check`（整形・lint）→ `pnpm typecheck` と Web の `tsc` → `pnpm test`（domain・application・Convex・api・web）。`pnpm codegen` をやり直して、コミットした `convex/_generated` と食い違っていないかも確かめる | 数分     |
| `e2e`    | デモ版（ブラウザ内の Convex）を建てて `e2e/screenshots.mjs`（撮影・操作の検証・axe の a11y）と `e2e/pwa.mjs` を回す。撮った画面と a11y の結果は Actions の成果物（14 日）に残し、リポジトリには入れない                                                                                                                                           | 4 分前後 |

ブラウザは runner に入っている Chrome（`/usr/bin/google-chrome`）を使い、Playwright のブラウザは落とさない。

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
