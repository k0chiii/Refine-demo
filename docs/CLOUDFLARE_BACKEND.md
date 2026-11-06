# Cloudflare 完結のバックエンド（apps/cloudflare）

Convex に依存せず、Cloudflare の中だけで業務データの正本を持つための土台。当面は Convex を使い続ける（利用者指示 2026-11-06）。
この文書は「Convex が今担っていること」を 1 つずつ Cloudflare の部品に対応づけ、どこまで実装済みかを示す。

## 形

```
利用者 ──Cloudflare Access の JWT（開発は X-MF100-Identity）──▶ Hono（apps/cloudflare/src/app.ts）
                                                                  │ POST /u/:name { args }   GET /ws
                                                                  ▼
                                       Durable Object MF100Database（src/db.ts。SQLite。1 つ）
                                         run(): 1 呼び出し = 1 トランザクション = usecase(ctx, principal, ...args)
                                         書いたテーブル名を WebSocket で配る
                                                                  │ implements ports（src/sqlite/context.ts）
                                                                  ▼
                                       packages/application（ユースケース） → packages/domain
```

- 依存の向きは変えない: `apps/cloudflare → packages/application → packages/domain`。業務規則は domain、Durable Object は Convex と同じくアダプタに留める。
- テーブルは文書方式（`id, doc(JSON)` と検索に使う項目の生成列 + index）。Convex の document と同じ粒度なので、アダプタは `testing/inMemory.ts` の写しになる。
- 1 つの Durable Object が全部の書き込みを直列にする（入力ゲート）。Convex の mutation の直列化と同じ性質。`ponytail:` 書き込みが全体で直列。足りなくなったら年度や制作物で分ける。

## 証明のしかた

`apps/cloudflare/vite.config.ts` の alias が、application のテスト 40 本の `../testing/inMemory.ts` だけを `src/testing/context.ts`（SQLite 版）へ差し替える。テストは 1 行も変えない。

```
pnpm --filter @mf100/cloudflare test     # 40 ファイル / 351 件 + apps/cloudflare 自身のテスト
pnpm --filter @mf100/cloudflare dev      # wrangler dev（DO の SQLite はローカル）
```

## Convex の機能 → Cloudflare の部品

| Convex が担っていること                                 | 使っている所                              | Cloudflare の部品                                                                                                        | 状態                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| document DB + index                                     | schema.ts（95 index）                     | Durable Object の SQLite。文書テーブル + 生成列 index                                                                    | **実装済み**（src/sqlite）                                                                                                              |
| mutation = 直列化されたトランザクション                 | 全 mutation                               | DO の入力ゲート + `ctx.storage.transaction()`（throw で巻き戻し。wrangler dev で確認）                                   | **実装済み**（src/db.ts）                                                                                                               |
| query の購読（画面の自動更新）                          | web の useQuery 79 ファイル               | DO の WebSocket（休止 API）。書いたテーブル名を配り、受け手が読み直す。粒度はテーブル（Convex は読み集合）               | **実装済み**（配る側）。web 側は未着手                                                                                                  |
| 公開関数（query 52 / mutation 76）                      | apps/convex/*.ts                          | `POST /u/:name`。application のユースケース（ctx, principal, ...）を名前で呼ぶ。登録表は `scripts/registry.mjs` が生成   | **実装済み**（ユースケース経由のもの）。Convex にしか無い読み取り（listMyWorks 等の一覧の組み立て）は `src/queries/` に書き直す。未着手 |
| 認証（@convex-dev/auth + Nogiku OIDC）                  | auth.ts                                   | Cloudflare Access（JWT。apps/api の accessVerifier と同じ検証）。Nogiku の profile（ふりがな・組織権限）の同期は未着手   | **部分**（本人の特定まで）                                                                                                              |
| 認可（Principal の組み立て）                            | lib/principal.ts                          | DO の中で users/groups/teams から組む（src/run.ts principalOf）                                                          | **実装済み**                                                                                                                            |
| crons（6 本）                                           | crons.ts                                  | `triggers.crons` 毎分 → DO の runJobs（受付終了は毎分、残りは毎時）。AI 結果・処理ジョブの期限切れは対象の機能ごと未着手 | **部分**（4/6）                                                                                                                         |
| scheduler.runAfter（配信・索引・続きの処理）            | adapters.ts ほか 10 箇所                  | DO の alarm か Queues。同じ DO の中で `ctx.waitUntil` でもよい                                                           | 未着手                                                                                                                                  |
| ファイル（R2）                                          | apps/api                                  | そのまま apps/api（R2）。api の Convex 呼び出し（convexGateway）を `/u/:name` に向ける                                   | 未着手（api 側）                                                                                                                        |
| 全文検索（searchIndex 2 本）                            | works, users                              | SQLite FTS5（DO で使えることを確認）                                                                                     | 未着手                                                                                                                                  |
| ベクトル検索（vectorIndex 1 本）                        | semanticRules                             | Vectorize                                                                                                                | 未着手                                                                                                                                  |
| @convex-dev/aggregate（制作物の集計）                   | lib/workAggregate.ts                      | SQL の集計（COUNT / GROUP BY）。派生表は要らない                                                                         | 未着手                                                                                                                                  |
| @convex-dev/migrations                                  | migrations.ts                             | `migrate()` の `CREATE TABLE IF NOT EXISTS` + 行の書き換えは DO の alarm で分割                                          | 未着手                                                                                                                                  |
| @convex-dev/presence（誰が見ているか）                  | presence.ts                               | 同じ DO の WebSocket に乗せる                                                                                            | 未着手                                                                                                                                  |
| @convex-dev/prosemirror-sync（文章の共同編集）          | collaboration.ts                          | 文書ごとの Durable Object（Yjs/ProseMirror の step を直列化）                                                            | 未着手                                                                                                                                  |
| @convex-dev/rate-limiter                                | ai.ts ほか                                | Workers の `ratelimits` binding（apps/api で使用中）                                                                     | 未着手                                                                                                                                  |
| @convex-dev/workflow / workpool（AI・処理の多段ジョブ） | aiWorkflow.ts, processing.ts, delivery.ts | Cloudflare Workflows（多段）+ Queues（並列度）                                                                           | 未着手                                                                                                                                  |
| HTTP action（/internal/*、/og/work）                    | http.ts                                   | Hono の route。apps/api から呼ぶ内部 API はサービス認証ごと移す                                                          | 未着手                                                                                                                                  |
| Workers AI・OCR                                         | apps/api（既に Cloudflare）               | そのまま                                                                                                                 | 済み（既存）                                                                                                                            |

## 次にやる順（提案）

1. apps/web が使う読み取り（Convex の query）の書き直し。`src/queries/` に `listMyWorks` から。購読はテーブル名で読み直す。
2. apps/api の convexGateway を `/u/:name` 向けに差し替える（提出・添付の内部 API）。
3. 外への通知（scheduler.runAfter）を DO の alarm に。
4. 検索（FTS5）・集計（SQL）・AI の多段処理（Workflows）。

## 決めたこと

- D1 ではなく Durable Object の SQLite: D1 には対話的トランザクションが無く、ユースケース（async）を 1 トランザクションに包めない。DO は `transaction()` で包めて、購読の配信も同じ場所でできる。
- ORM・クエリビルダは入れない: ポートの数（31）に対して SQL は素朴で足りる。依存を増やすより inMemory と並べて読める方が安い。
- 登録表（registry.ts）は生成する: ユースケースを足して登録を忘れる事故を、テスト（registry.test.ts）で赤くする。
