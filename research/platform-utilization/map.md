# Vite+・Convex・Cloudflare 活用調査

調査日: 2026-10-22。対象はこのチェックアウト。クラウド管理画面・実測・課金状態は未確認。

## 問い

MF100 Refine の実装と設定に照らし、Vite+・Convex・Cloudflare の機能をどこで活用できるか。導入効果、破綻する条件、重複する責務を一次資料で確かめる。

## 要る主張

1. 3製品の知見と機能一覧はどこに集まっているか（場）。
2. 現状の Vite+ 利用で、タスク・キャッシュ・ビルド・CI を改善できる箇所と無効化条件は何か。
3. 現状の Convex の一覧・検索・リアルタイム・集計を、正確性と認可を保ってどこまで改善できるか。
4. 現状の AI 校正・通知・外部 API・移行に、再試行・冪等性・長時間処理をどう適用できるか。
5. 現状の Cloudflare の非公開ファイル提出・配信・画像・動画に、どの機能が使え、どこで制約があるか。
6. 3製品の機能を最大限活用する際、環境分離・監視・認可・費用・責務の重複による制約は何か。


### 原文の場所

| 問い | 状態 | 原文の場所と短い引用 |
|---|---|---|
| 1. 3製品の知見と機能一覧が集まる場 | 原文あり | `sources/vite-config.md:6` — ``Vite+ keeps project configuration in one place: `vite.config.ts`, allowing you to consolidate many top-level configuration files`` / `sources/convex-components.md:3` — ``Convex Components package up code and data in a sandbox that allows you to confidently and`` / `sources/cloudflare-observability.md:17` — ``Cloudflare Workers provides comprehensive observability tools to help you understand how your applications are performing, diagnose`` |
| 2. Vite+ のタスク・キャッシュ・CI と失効条件 | 原文あり | `sources/vite-cache.md:47` — ``\| `cache.scripts` \| `false` \| Cache `package.json` scripts            \|`` / `sources/vite-run.md:102` — ``dependsOn: ['lint'],`` / `sources/vite-ci-cache.md:6` — ``Experimental`` |
| 3. Convex の一覧・検索・購読の改善と限界 | 原文あり | `sources/convex-pagination.md:14` — ``usePaginatedQuery`](/api/modules/react.md#usepaginatedquery) React hook.`` / `sources/convex-search.md:184` — ``Search indexes work best with English or other Latin-script languages. Text is tokenized using Tantivy's [`SimpleTokenizer`](https://docs.rs/tantivy/latest/tantivy/tokenizer/struct.SimpleTokenizer.html),`` / `sources/convex-aggregate.md:52` — ``O(log(n))`-time lookups, instead of the `O(n)``` |
| 4. 外部処理の再試行・冪等性・長時間処理 | 原文あり | `sources/convex-scheduling.md:205` — ``actions may have side effects, they are not automatically retried by Convex. Thus, actions will be`` / `sources/convex-workpool.md:8` — ``limiting how many run in parallel.`` / `sources/cloudflare-queues.md:2` — ``Queues provides at-least-once message delivery by default.`` |
| 5. 非公開ファイル・画像・動画の機能と制約 | 原文あり | `sources/cloudflare-r2-upload.md:23` — ``Large files, or when you need parallelism and resumability \|`` / `sources/cloudflare-images.md:19` — ``binding works with raw image bytes. You can pass images from any source, including [Images](https://developers.cloudflare.com/images/storage/upload-images/methods/), [R2](https://developers.cloudflare.com/r2/),`` / `sources/cloudflare-images-limits.md:64` — ``maximum input size for `.input()` is 20 MB.`` / `sources/cloudflare-media.md:30` — ``public open beta. During this period:`` |
| 6. 環境・監視・認可・費用・復旧の制約 | 原文あり | `sources/cloudflare-types.md:19` — ``We recommend you generate types for your Worker by running [`wrangler types`](https://developers.cloudflare.com/workers/wrangler/commands/general/#types). Cloudflare also publishes type`` / `sources/cloudflare-rate-limit.md:19` — ``approximate and apply separately in each Cloudflare location. Requests can exceed your configured limit while counts`` / `sources/convex-backups.md:15` — ``Deployment configuration and other data (code, environment variables, scheduled functions, etc.) will not be included.`` |


## 用語

- Vite Task / automatic tracking / cache fingerprint — https://viteplus.dev/guide/cache
- Convex Components / reactive queries / durable workflow — https://docs.convex.dev/
- Workers bindings / workerd / R2 / Queues / Workflows — https://developers.cloudflare.com/

## 人

- VoidZero / Vite+ 公式開発者 — https://github.com/voidzero-dev/vite-plus
- Convex / get-convex 公式開発者 — https://github.com/get-convex
- Cloudflare 公式開発者 — https://developers.cloudflare.com/

## 場

- Vite+ Guide・Config・公式リポジトリ — https://viteplus.dev/guide/ / https://github.com/voidzero-dev/vite-plus
- Convex Docs・公式 Components・Stack — https://docs.convex.dev/ / https://www.convex.dev/components / https://stack.convex.dev/
- Cloudflare Developers・公式リポジトリ — https://developers.cloudflare.com/ / https://github.com/cloudflare/workers-sdk
- Context7 は発見用。根拠はリンク先の公式原文。

## 原文（sources/）

| 論文・資料 | ファイル | 元の URL | どこから来たか（周・動き） |
|---|---|---|---|

| 〔公式〕cloudflare-access | [sources/cloudflare-access.md](sources/cloudflare-access.md) | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-ai | [sources/cloudflare-ai.md](sources/cloudflare-ai.md) | https://developers.cloudflare.com/workers-ai/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-ai-gateway | [sources/cloudflare-ai-gateway.md](sources/cloudflare-ai-gateway.md) | https://developers.cloudflare.com/ai-gateway/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-browser | [sources/cloudflare-browser.md](sources/cloudflare-browser.md) | https://developers.cloudflare.com/browser-rendering/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡。HTML本文から保存 |
| 〔公式〕cloudflare-cache | [sources/cloudflare-cache.md](sources/cloudflare-cache.md) | https://developers.cloudflare.com/workers/runtime-apis/cache/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-containers | [sources/cloudflare-containers.md](sources/cloudflare-containers.md) | https://developers.cloudflare.com/containers/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-d1 | [sources/cloudflare-d1.md](sources/cloudflare-d1.md) | https://developers.cloudflare.com/d1/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-durable | [sources/cloudflare-durable.md](sources/cloudflare-durable.md) | https://developers.cloudflare.com/durable-objects/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-env | [sources/cloudflare-env.md](sources/cloudflare-env.md) | https://developers.cloudflare.com/workers/wrangler/environments/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-images | [sources/cloudflare-images.md](sources/cloudflare-images.md) | https://developers.cloudflare.com/images/optimization/binding/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-images-limits | [sources/cloudflare-images-limits.md](sources/cloudflare-images-limits.md) | https://developers.cloudflare.com/images/get-started/limits/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-kv | [sources/cloudflare-kv.md](sources/cloudflare-kv.md) | https://developers.cloudflare.com/kv/concepts/how-kv-works/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-limits | [sources/cloudflare-limits.md](sources/cloudflare-limits.md) | https://developers.cloudflare.com/workers/platform/limits/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-media | [sources/cloudflare-media.md](sources/cloudflare-media.md) | https://developers.cloudflare.com/stream/transform-videos/bindings/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-observability | [sources/cloudflare-observability.md](sources/cloudflare-observability.md) | https://developers.cloudflare.com/workers/observability/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-queues | [sources/cloudflare-queues.md](sources/cloudflare-queues.md) | https://developers.cloudflare.com/queues/reference/delivery-guarantees/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-r2-events | [sources/cloudflare-r2-events.md](sources/cloudflare-r2-events.md) | https://developers.cloudflare.com/r2/buckets/event-notifications/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-r2-lifecycle | [sources/cloudflare-r2-lifecycle.md](sources/cloudflare-r2-lifecycle.md) | https://developers.cloudflare.com/r2/buckets/object-lifecycles/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-r2-upload | [sources/cloudflare-r2-upload.md](sources/cloudflare-r2-upload.md) | https://developers.cloudflare.com/r2/objects/upload-objects/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-rate-limit | [sources/cloudflare-rate-limit.md](sources/cloudflare-rate-limit.md) | https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-static | [sources/cloudflare-static.md](sources/cloudflare-static.md) | https://developers.cloudflare.com/workers/static-assets/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-stream | [sources/cloudflare-stream.md](sources/cloudflare-stream.md) | https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-types | [sources/cloudflare-types.md](sources/cloudflare-types.md) | https://developers.cloudflare.com/workers/languages/typescript/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-vectorize | [sources/cloudflare-vectorize.md](sources/cloudflare-vectorize.md) | https://developers.cloudflare.com/vectorize/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-versions | [sources/cloudflare-versions.md](sources/cloudflare-versions.md) | https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-vite | [sources/cloudflare-vite.md](sources/cloudflare-vite.md) | https://developers.cloudflare.com/workers/vite-plugin/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕cloudflare-workflows | [sources/cloudflare-workflows.md](sources/cloudflare-workflows.md) | https://developers.cloudflare.com/workflows/build/rules-of-workflows/index.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-aggregate | [sources/convex-aggregate.md](sources/convex-aggregate.md) | https://raw.githubusercontent.com/get-convex/aggregate/main/README.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-backups | [sources/convex-backups.md](sources/convex-backups.md) | https://docs.convex.dev/database/backup-restore.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-best-practices | [sources/convex-best-practices.md](sources/convex-best-practices.md) | https://docs.convex.dev/understanding/best-practices.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-components | [sources/convex-components.md](sources/convex-components.md) | https://docs.convex.dev/components | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡。HTML本文から保存 |
| 〔公式〕convex-indexes | [sources/convex-indexes.md](sources/convex-indexes.md) | https://docs.convex.dev/database/reading-data/indexes.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-migrations | [sources/convex-migrations.md](sources/convex-migrations.md) | https://raw.githubusercontent.com/get-convex/migrations/main/README.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-optimistic | [sources/convex-optimistic.md](sources/convex-optimistic.md) | https://docs.convex.dev/client/react/optimistic-updates.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-pagination | [sources/convex-pagination.md](sources/convex-pagination.md) | https://docs.convex.dev/database/pagination.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-presence | [sources/convex-presence.md](sources/convex-presence.md) | https://raw.githubusercontent.com/get-convex/presence/main/README.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-previews | [sources/convex-previews.md](sources/convex-previews.md) | https://docs.convex.dev/production/multiple-deployments.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-prosemirror | [sources/convex-prosemirror.md](sources/convex-prosemirror.md) | https://raw.githubusercontent.com/get-convex/prosemirror-sync/main/README.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-rate-limiter | [sources/convex-rate-limiter.md](sources/convex-rate-limiter.md) | https://raw.githubusercontent.com/get-convex/rate-limiter/main/README.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-scheduling | [sources/convex-scheduling.md](sources/convex-scheduling.md) | https://docs.convex.dev/scheduling/scheduled-functions.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-search | [sources/convex-search.md](sources/convex-search.md) | https://docs.convex.dev/search/text-search.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-vector | [sources/convex-vector.md](sources/convex-vector.md) | https://docs.convex.dev/search/vector-search.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-workflow | [sources/convex-workflow.md](sources/convex-workflow.md) | https://raw.githubusercontent.com/get-convex/workflow/main/README.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕convex-workpool | [sources/convex-workpool.md](sources/convex-workpool.md) | https://raw.githubusercontent.com/get-convex/workpool/main/README.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-build | [sources/vite-build.md](sources/vite-build.md) | https://viteplus.dev/guide/build.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-cache | [sources/vite-cache.md](sources/vite-cache.md) | https://viteplus.dev/guide/cache.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-check | [sources/vite-check.md](sources/vite-check.md) | https://viteplus.dev/guide/check.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-ci | [sources/vite-ci.md](sources/vite-ci.md) | https://viteplus.dev/guide/ci.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-ci-cache | [sources/vite-ci-cache.md](sources/vite-ci-cache.md) | https://viteplus.dev/guide/github-actions-cache.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-config | [sources/vite-config.md](sources/vite-config.md) | https://viteplus.dev/config.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-pack | [sources/vite-pack.md](sources/vite-pack.md) | https://viteplus.dev/guide/pack.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-run | [sources/vite-run.md](sources/vite-run.md) | https://viteplus.dev/guide/run.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-runtime | [sources/vite-runtime.md](sources/vite-runtime.md) | https://viteplus.dev/guide/env.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-staged | [sources/vite-staged.md](sources/vite-staged.md) | https://viteplus.dev/guide/commit-hooks.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |
| 〔公式〕vite-test | [sources/vite-test.md](sources/vite-test.md) | https://viteplus.dev/guide/test.md | 1周目・公式ガイドから制約/リファレンスへ、または公式開発者のリポジトリを追跡 |

| 〔公式〕vite-migrate | [sources/vite-migrate.md](sources/vite-migrate.md) | https://viteplus.dev/guide/migrate-rules.md | 1周目・移行規則のリファレンスへ |

## 次の手がかり

- 英語: 各公式ガイドの機能一覧から制約・API リファレンスへたどる。
- 日本語: 製品名と現状の機能（校正・アップロード・キャッシュ）で検索し、公式資料へのリンクを比較する。
- Vite+ は導入済み1.2.0と現行ドキュメントの差を確認する。
- Convex は既存の索引、検索索引、上限付き走査と利用箇所を対応づける。
- Cloudflare は認可つき R2 配信、アップロード上限、非同期ジョブ、環境設定を対応づける。

## 終了時の未確認事項

- 6つの問いに原文の場所が付いたため1周目で停止。検索役がいないので飽和率は算出しない。
- 実設定・請求・性能、Vite plugin の実動互換性、既存 workRoles の同期状態は未確認。
- Turnstile は取得判定の問題で保存できず。導入仕様を評価していない。
- 外部データ送信、課金、本番反映、データ移行は別途利用者の明示承認が必要な既存ルール。今回実行なし。
