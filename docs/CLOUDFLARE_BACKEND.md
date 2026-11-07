# Cloudflare 完結のバックエンド（apps/cloudflare）

Convex に依存せず、Cloudflare の中だけで業務データの正本を持つ実装。Convex と同じ関数名・引数・戻りで応える。
当面の本番は Convex のまま（利用者指示 2026-11-06）。切り替えは `apps/api` の `BACKEND` と web のビルドモードだけで行い、Convex 側のコードは消していない。
この文書は現状の事実と状態だけを書く。経緯は `.audit/cf-backend.tsv`。

## 形

```
ブラウザ（apps/web --mode cloudflare）          apps/api（BACKEND=cloudflare）         Queue / Workflow
   │ POST /f/<module>:<fn>   GET /ws                 │ POST /f/...（サービス秘密）           │ POST /internal/processing
   │ GET/POST /auth/*                                │ POST /f/submissions:listOrphanObjects  │
   ▼                                                 ▼                                       ▼
Hono（apps/cloudflare/src/app.ts）  本人の特定・サービス秘密の確認・引数の検証（zod の strictObject）
   │ stub.call(name, identity, args, serviceOk)
   ▼
Durable Object MF100Database（src/db.ts。SQLite。1 つ）
   ├ execute（src/run.ts）  1 呼び出し = 1 トランザクション。DomainError は値で返し、巻き戻す
   ├ WebSocket  書いた表の名前を配る。query の戻りには読んだ表の名前（reads）が付く
   ├ alarm / cron  あとで動く仕事（jobs 表）と、毎分の cron（src/jobs.ts）
   └ ポートの SQLite 実装（src/sqlite）
        ▼
packages/application（ユースケース）→ packages/domain
```

- 依存の向きは `apps/cloudflare → packages/application → packages/domain`。業務規則は domain に置き、`src/functions/*` は認証・引数・ユースケース呼び出しだけを持つ。
- 表は文書方式（`id, doc(JSON)` と、検索に使う項目の生成列と index）。Convex の document と同じ粒度。
- 全関数は `src/functions/index.ts` の登録表にある。鍵は Convex の `getFunctionName` と同じ `<module>:<fn>`。
- 1 つの Durable Object が全部の書き込みを直列にする（入力ゲート）。Convex の mutation の直列化と同じ性質。
- 追加の口: `/auth/*`（サインイン・JWT・JWKS）、`/ws`、`/internal/processing`（ファイル処理の台帳。契約は Convex の http.ts と同じ）、`/internal/import`（データ移行の間だけ）、`/health`。

## 証明のしかた

同じ契約を 4 つの層で確かめる。

1. application のテストの差し替え。`vite.config.ts` の alias が、application のテスト 40 本の `../testing/inMemory.ts` だけを `src/testing/context.ts`（SQLite 版）へ差し替える。テストは 1 行も変えない。40 ファイル 351 件が SQLite で通る。
2. 差分テスト（`src/differential.test.ts`）。同じ手順の表（463 行、読み取り 41 関数）を Convex（convex-test）と Cloudflare（Node 上の偽の DO）に流し、戻りを突き合わせる。直さない差は理由つきの許可表だけ（派生表の版の印・不透明な cursor・audit の id）。当たらなくなった許可は赤くなる。
3. Node の HTTP テスト（`src/*.test.ts` 16 ファイル 256 件）。`POST /f/:name` の一周、サービス認証、巻き戻し、通知、認証、配信、AI、仕事、清掃、取り込み。全体では 56 ファイル 607 件。
4. 本物の Worker + Durable Object。`scripts/smoke.sh`（401 / 404 / 400 / 403 / 409 / 200、WebSocket の変更通知、cron の入口、サービス秘密、清掃、取り込みの往復）。web の E2E は `apps/web/e2e/specs/cloudflare-smoke.spec.ts` の 1 本（サインイン → 制作物の登録 → 別タブへの反映）。

```
cd apps/cloudflare
pnpm exec vp test run                 # 上の 1〜3
pnpm exec tsc -p tsconfig.json --noEmit
node scripts/parity.mjs --check       # web / api が使う公開関数が登録表に全部あるか
rm -rf .wrangler/state
pnpm dev --port 8790 --var MF100_SYSTEM_ADMIN_SUBJECTS:u_admin \
  --var MF100_UPLOAD_SECRET:0123456789abcdef0123456789abcdef \
  --var PROCESSING_SECRET:0123456789abcdef0123456789abcdef \
  --var MF100_CLEANUP_SECRET:0123456789abcdef0123456789abcdef --var MF100_IMPORT_SECRET:fedcba9876543210fedcba9876543210
# 別の端末で
UPLOAD_SECRET=0123456789abcdef0123456789abcdef PROCESSING_SECRET=0123456789abcdef0123456789abcdef \
  MF100_CLEANUP_SECRET=0123456789abcdef0123456789abcdef MF100_IMPORT_SECRET=fedcba9876543210fedcba9876543210 bash scripts/smoke.sh 8790
pkill -f wrangler; pkill -f workerd
```

web の E2E の起こし方は spec の先頭のコメントにある。CI の既定の対象ではない。

## Convex の機能 → Cloudflare の部品

状態の定義。実装済みはコードがあり、上の層で確かめたもの。部分は機能の一部が無いか、外部の実サービスと接続して確かめていないもの。未着手は無いもの。

| Convex が担っていること                                   | Cloudflare の部品                                                                                                                                                                   | 状態   | 残り                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| document DB + index                                       | Durable Object の SQLite。文書表 + 生成列 + index（`src/sqlite`）                                                                                                                   | 実装済 |                                                                                                                        |
| mutation = 直列化されたトランザクション                   | DO の入力ゲート + `storage.transaction()`。途中で投げたら何も残らない（`src/db.ts`、`src/run.ts`）                                                                                  | 実装済 | 書き込みは全体で直列（DO 1 つ）                                                                                        |
| query の購読                                              | DO の WebSocket。書いた表の名前を配り、web の client（`apps/web/src/cloudflare/client.ts`）が読んだ表の交わる query だけ読み直す                                                    | 実装済 | 粒度は表（Convex は読んだ範囲）。通信の失敗は黙って待つ                                                                |
| 公開関数 133（query 55 / mutation 76 / action 2）         | `POST /f/<module>:<fn>`。`src/functions/*`                                                                                                                                          | 実装済 | 133 本とも登録表にある。web / api が使う 126 本は parity で機械的に照合                                                |
| 引数の検証（`v.object`）                                  | 全関数の `args` が zod の `strictObject`。未知の鍵を拒む。不正は 400 `invalid_args`                                                                                                 | 実装済 |                                                                                                                        |
| 認可（Principal の組み立て）                              | DO の中で users / groups / teams から組む（`src/functions/principal.ts`）。ユースケースは Convex と同じ                                                                             | 実装済 |                                                                                                                        |
| 認証（Convex Auth + Nogiku OIDC）                         | Worker が OIDC を自分で回し、ES256 の JWT と JWKS を出す（`src/auth`）。モック（`POST /auth/mock`）、refresh の回転、PKCE と同じ形で verifier に結び付けた一時コード（`challenge`） | 部分   | 本物の Nogiku とは未接続（テストは偽の issuer）。Cloudflare Access の JWT も受けるが本物のテナントでは未確認           |
| 組織権限（Nogiku Access）                                 | `src/auth/access.ts`。Convex の lib/nogikuAccess.ts と同じ振る舞い。`NOGIKU_ACCESS_ENABLED=true` のときだけ users.orgPermissions を主体に載せる（それ以外は `["*"]`）               | 部分   | 本物の API とは未接続                                                                                                  |
| crons（6 本）                                             | `triggers.crons` 毎分 → `runJobs`。受付終了は毎分、残りは毎時、AI の一時結果は 5 分ごと                                                                                             | 実装済 | 6 本とも移した                                                                                                         |
| scheduler.runAfter / workpool                             | jobs 表 + alarm（`src/jobs.ts`）。ユースケースと同じトランザクションで積む。cron が毎分取りこぼしを拾う                                                                             | 実装済 | 種類は deliver / resolveSlack / planInfoSync / continueMarkAllRead / indexRule / aiProofread。feedbackMigration は無い |
| 外への通知（Web Push / Resend / Slack めいちゃん）        | `src/delivery`。VAPID と aes128gcm（RFC 8291 の固定例で一致）、メール、Slack                                                                                                        | 部分   | 実際の送信先へは未送信（偽の fetch で確認）。端末の宛先が引けなければ 4 回で打ち切る                                   |
| AI 校正（Anthropic / Workers AI）と多段ジョブ             | `ai:*`、`aiWorkflow:*`（`src/functions`、`src/ai`）。多段は jobs の 1 仕事（aiProofread）に畳んだ。一時結果は 1 時間で消える                                                        | 部分   | 実際のキー・モデルでは未確認。キーが無ければ使えず外へ何も送らない                                                     |
| ファイル処理の台帳（processing）と `/internal/processing` | `processing:*` と同じ契約の口（Bearer `PROCESSING_SECRET`、32 文字以上）                                                                                                            | 実装済 | 実際の処理（Queue / Workflow）は apps/api のまま                                                                       |
| ファイル（R2）                                            | apps/api がそのまま持つ。`BACKEND=cloudflare` で gateway が `/f/...` を呼ぶ（提出・清掃・処理）                                                                                     | 部分   | api → 本物の Worker の通しは未実施（api のテストは偽の Worker）                                                        |
| R2 の清掃（`/internal/upload-orphans`）                   | `submissions:listOrphanObjects` / `markObjectsPurged`（Bearer `MF100_CLEANUP_SECRET`、利用者なし）。版・コメントの添付・試行を 1 本に束ねる                                         | 実装済 | 実際の R2 の削除は apps/api                                                                                            |
| 全文検索（searchIndex 2 本）                              | SQLite FTS5。Convex と同じ 1/2-gram（`src/sqlite/workSearch.ts`）。本物の DO で通る                                                                                                 | 実装済 |                                                                                                                        |
| ベクトル検索（vectorIndex 1 本）                          | ルールの埋め込みを SQLite に JSON で持ち、全件を JS でコサイン類似度（`semanticRules:search`）。埋め込みは apps/api の `/internal/ai/embed`                                         | 部分   | 実際のモデルでは未確認。千件を超えたら Vectorize                                                                       |
| @convex-dev/aggregate                                     | `works` の `GROUP BY`。派生表の `workSummaries` / `workRoles` / `notificationCounters` は書き込みと同じトランザクションで作り直す                                                   | 実装済 | `workAggregateEntries` は持たない                                                                                      |
| @convex-dev/migrations                                    | `migrate()` の `CREATE ... IF NOT EXISTS`                                                                                                                                           | 部分   | 既にある表へ列は足さない。本番の DO はまだ無いので不要                                                                 |
| @convex-dev/presence                                      | `src/collab/store.ts`。同じ DO の表（心拍 30 秒、75 秒で切れ）                                                                                                                      | 実装済 |                                                                                                                        |
| @convex-dev/prosemirror-sync                              | `collaboration:*`（`src/collab`）。1 行 1 ステップ。版の飛んだ送信は断る（Convex の部品より厳しい）                                                                                 | 実装済 |                                                                                                                        |
| @convex-dev/rate-limiter                                  | `src/rateLimit.ts`（fixed window / token bucket。DO の表）                                                                                                                          | 実装済 | 窓の始まりをずらさない                                                                                                 |
| HTTP action（`/internal/*`、`/og/work`）                  | サービス専用関数（`auth: { service, withUser }`）。404 で在ることを隠す。`/og/work` の応答は public の `works:ogSummary`                                                            | 部分   | `/og/work` の HTTP の口そのものは持たない（関数を直に引く）                                                            |
| Convex クライアント（convex/react、Convex Auth）          | web の `--mode cloudflare`。alias で 2 つだけ差し替える（`apps/web/src/cloudflare`）                                                                                                | 部分   | `vp dev` 相手の E2E は Lit のエラーで落ちる。E2E は 1 本                                                               |
| 既存データ（Convex → Cloudflare）                         | `src/migrate` と `scripts/migrate`。変換・冪等な取り込み・派生表の作り直し・確認                                                                                                    | 部分   | 道具だけ。本番では実行していない（過去データの移行は利用者の明示承認まで行わない）                                     |
| Workers AI・OCR                                           | apps/api（既に Cloudflare）                                                                                                                                                         | 実装済 | 変更なし                                                                                                               |

状態の数: 実装済み 16 / 部分 10 / 未着手 0（計 26 行）。

## parity（Convex の関数との対応）

`node scripts/parity.mjs` の出力。Convex の `api.d.ts` と `convex/<module>.ts` から関数を拾い、`src/functions` の登録表と突き合わせる。`--check` は web / api が使う公開関数が登録表に無ければ 1 で終わる。

### 内部関数で移していないもの

内部（internal.*）49 本のうち 20 本を移した。残る 29 本は、Convex の部品の都合か、別の道具で代わっているか、一度きりの関数のため移していない。

| Convex の内部関数                                                                                      | 本数 | 移していない理由                                                                                |
| ------------------------------------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------- |
| `ai:prepare` / `recordUse` / `reserve`                                                                 | 3    | `ai:proofread` の内部の部品。Cloudflare は 1 つの関数の中で枠の確認と記録まで済ませる           |
| `aiWorkflow:claim` / `execute` / `expire` / `finish` / `prepare`                                       | 5    | workflow の内部。Cloudflare は jobs の `aiProofread`（`executeAiJob`）と cron の `expireAiJobs` |
| `revisions:closeExpired` / `remindDeadlines`、`submissions:expireSessions`、`commentFiles:expireFiles` | 4    | cron の入口。`runJobs` が application のユースケースを直に呼ぶ                                  |
| `dashboard:get`                                                                                        | 1    | 公開の `dashboard:check` / `make` / `works` の内部の実装                                        |
| `delivery:*` 6 本、`deliveryNode:deliver` / `resolveSlack`                                             | 8    | 通知の配信。jobs の `deliver` / `resolveSlack` と `src/delivery`                                |
| `notifications:continueMarkAllRead`、`planInfo:sync`                                                   | 2    | jobs の `continueMarkAllRead` / `planInfoSync`                                                  |
| `semanticRules:current` / `indexRule` / `resolve` / `store`                                            | 4    | ルールの索引づけの部品。jobs の `indexRule` と `semanticRules:search` の中                      |
| `notationSeed:importSamples`、`seed:demo`                                                              | 2    | デモ・サンプルの投入。本番では使わない                                                          |

Convex に無い名前が登録表に 5 本ある（`collaboration:getSnapshot` / `getSteps` / `latestVersion` / `submitSnapshot` / `submitSteps`）。Convex では prosemirror-sync の部品の関数で、Cloudflare は同じ名前で登録している。

### 出力

- 公開（api.*）: 133（query 55 / mutation 76 / action 2）のうち Cloudflare にある 133
- 内部（internal.*）: 49 のうち Cloudflare にある 20
- web / api が使う公開関数: 126 のうち Cloudflare にある 126（無い 0）
- 登録表: 158（Convex に無い名前 5: collaboration:getSnapshot, collaboration:getSteps, collaboration:latestVersion, collaboration:submitSnapshot, collaboration:submitSteps）

| 名前                                | Convex の種類 | 公開/内部 | web・api が使う | Cloudflare にある |
| ----------------------------------- | ------------- | --------- | --------------- | ----------------- |
| `acl:adminWorks`                    | query         | public    | 1 ファイル      | あり              |
| `acl:grant`                         | mutation      | public    | 1 ファイル      | あり              |
| `acl:list`                          | query         | public    | 1 ファイル      | あり              |
| `acl:revoke`                        | mutation      | public    | 1 ファイル      | あり              |
| `acl:searchUsers`                   | query         | public    | 1 ファイル      | あり              |
| `acl:workSummary`                   | query         | public    | -               | あり              |
| `admin:auditLog`                    | query         | public    | 1 ファイル      | あり              |
| `admin:setGeneration`               | mutation      | public    | 1 ファイル      | あり              |
| `admin:setSystemAdmin`              | mutation      | public    | 1 ファイル      | あり              |
| `admin:workStats`                   | query         | public    | 1 ファイル      | あり              |
| `ai:prepare`                        | query         | internal  | -               | -                 |
| `ai:proofread`                      | action        | public    | 1 ファイル      | あり              |
| `ai:recordUse`                      | mutation      | internal  | -               | -                 |
| `ai:reserve`                        | mutation      | internal  | -               | -                 |
| `ai:status`                         | query         | public    | 1 ファイル      | あり              |
| `aiWorkflow:cancel`                 | mutation      | public    | 1 ファイル      | あり              |
| `aiWorkflow:claim`                  | mutation      | internal  | -               | -                 |
| `aiWorkflow:execute`                | action        | internal  | -               | -                 |
| `aiWorkflow:expire`                 | mutation      | internal  | -               | -                 |
| `aiWorkflow:finish`                 | mutation      | internal  | -               | -                 |
| `aiWorkflow:get`                    | query         | public    | 1 ファイル      | あり              |
| `aiWorkflow:prepare`                | query         | internal  | -               | -                 |
| `aiWorkflow:start`                  | mutation      | public    | 1 ファイル      | あり              |
| `approvals:confirm`                 | mutation      | public    | 1 ファイル      | あり              |
| `approvals:confirmationStatus`      | query         | public    | 1 ファイル      | あり              |
| `approvals:finalize`                | mutation      | public    | 1 ファイル      | あり              |
| `approvals:reopen`                  | mutation      | public    | 1 ファイル      | あり              |
| `artifacts:authorizeAccess`         | query         | public    | 2 ファイル      | あり              |
| `checks:add`                        | mutation      | public    | 1 ファイル      | あり              |
| `checks:complete`                   | mutation      | public    | 1 ファイル      | あり              |
| `checks:waive`                      | mutation      | public    | 1 ファイル      | あり              |
| `collaboration:enable`              | mutation      | public    | 1 ファイル      | あり              |
| `commentFiles:authorizeFile`        | query         | public    | 2 ファイル      | あり              |
| `commentFiles:beginFileUpload`      | mutation      | internal  | -               | あり              |
| `commentFiles:beginThumbUpload`     | mutation      | internal  | -               | あり              |
| `commentFiles:completeFileUpload`   | mutation      | internal  | -               | あり              |
| `commentFiles:completeThumbUpload`  | mutation      | internal  | -               | あり              |
| `commentFiles:expireFiles`          | mutation      | internal  | -               | -                 |
| `commentFiles:failFileUpload`       | mutation      | internal  | -               | あり              |
| `commentFiles:prepare`              | mutation      | public    | 1 ファイル      | あり              |
| `comments:assign`                   | mutation      | public    | 1 ファイル      | あり              |
| `comments:carryCandidates`          | query         | public    | 1 ファイル      | あり              |
| `comments:carryForward`             | mutation      | public    | 1 ファイル      | あり              |
| `comments:decide`                   | mutation      | public    | 1 ファイル      | あり              |
| `comments:edit`                     | mutation      | public    | 1 ファイル      | あり              |
| `comments:editReply`                | mutation      | public    | 1 ファイル      | あり              |
| `comments:events`                   | query         | public    | 1 ファイル      | あり              |
| `comments:markRead`                 | mutation      | public    | 1 ファイル      | あり              |
| `comments:migratedFromFeedback`     | query         | public    | 1 ファイル      | あり              |
| `comments:post`                     | mutation      | public    | 1 ファイル      | あり              |
| `comments:remove`                   | mutation      | public    | 1 ファイル      | あり              |
| `comments:removeReply`              | mutation      | public    | 1 ファイル      | あり              |
| `comments:reply`                    | mutation      | public    | 1 ファイル      | あり              |
| `comments:searchMentionCandidates`  | query         | public    | 1 ファイル      | あり              |
| `comments:setSubscription`          | mutation      | public    | 1 ファイル      | あり              |
| `comments:toggleReaction`           | mutation      | public    | 1 ファイル      | あり              |
| `comparisons:getOverride`           | query         | public    | 1 ファイル      | あり              |
| `comparisons:saveOverride`          | mutation      | public    | 1 ファイル      | あり              |
| `dashboard:check`                   | query         | public    | 3 ファイル      | あり              |
| `dashboard:checkBadge`              | query         | public    | 1 ファイル      | あり              |
| `dashboard:get`                     | query         | internal  | -               | -                 |
| `dashboard:make`                    | query         | public    | 1 ファイル      | あり              |
| `dashboard:works`                   | query         | public    | 3 ファイル      | あり              |
| `delivery:enqueue`                  | mutation      | internal  | -               | -                 |
| `delivery:plan`                     | query         | internal  | -               | -                 |
| `delivery:record`                   | mutation      | internal  | -               | -                 |
| `delivery:recordSlackLookup`        | mutation      | internal  | -               | -                 |
| `delivery:reserveSlackDm`           | mutation      | internal  | -               | -                 |
| `delivery:slackTarget`              | query         | internal  | -               | -                 |
| `deliveryNode:deliver`              | action        | internal  | -               | -                 |
| `deliveryNode:resolveSlack`         | action        | internal  | -               | -                 |
| `documents:get`                     | query         | public    | 3 ファイル      | あり              |
| `documents:save`                    | mutation      | public    | 3 ファイル      | あり              |
| `documents:writable`                | query         | public    | 2 ファイル      | あり              |
| `groups:list`                       | query         | public    | 2 ファイル      | あり              |
| `groups:remove`                     | mutation      | public    | 1 ファイル      | あり              |
| `groups:save`                       | mutation      | public    | 1 ファイル      | あり              |
| `home:pinned`                       | query         | public    | 1 ファイル      | あり              |
| `home:setPinned`                    | mutation      | public    | 1 ファイル      | あり              |
| `home:submitTargets`                | query         | public    | 1 ファイル      | あり              |
| `me:me`                             | query         | public    | 9 ファイル      | あり              |
| `me:setAvatar`                      | mutation      | public    | 1 ファイル      | あり              |
| `notation:categories`               | query         | public    | 1 ファイル      | あり              |
| `notation:decide`                   | mutation      | public    | 1 ファイル      | あり              |
| `notation:decideMany`               | mutation      | public    | 1 ファイル      | あり              |
| `notation:importBatch`              | mutation      | public    | 1 ファイル      | あり              |
| `notation:proposals`                | query         | public    | 2 ファイル      | あり              |
| `notation:propose`                  | mutation      | public    | 2 ファイル      | あり              |
| `notation:ruleBook`                 | query         | public    | 8 ファイル      | あり              |
| `notation:ruleHistory`              | query         | public    | 1 ファイル      | あり              |
| `notation:rulesForWork`             | query         | public    | 2 ファイル      | あり              |
| `notation:save`                     | mutation      | public    | 1 ファイル      | あり              |
| `notation:setEnabled`               | mutation      | public    | 1 ファイル      | あり              |
| `notation:setManager`               | mutation      | public    | 1 ファイル      | あり              |
| `notation:upsertCategory`           | mutation      | public    | 1 ファイル      | あり              |
| `notationSeed:importSamples`        | mutation      | internal  | -               | -                 |
| `notificationPrefs:get`             | query         | public    | 1 ファイル      | あり              |
| `notificationPrefs:update`          | mutation      | public    | 2 ファイル      | あり              |
| `notifications:continueMarkAllRead` | mutation      | internal  | -               | -                 |
| `notifications:list`                | query         | public    | 3 ファイル      | あり              |
| `notifications:markAllRead`         | mutation      | public    | 2 ファイル      | あり              |
| `notifications:markRead`            | mutation      | public    | 3 ファイル      | あり              |
| `notifications:markThreadRead`      | mutation      | public    | 1 ファイル      | あり              |
| `notifications:markUnread`          | mutation      | public    | 2 ファイル      | あり              |
| `notifications:sendTest`            | mutation      | public    | 1 ファイル      | あり              |
| `notifications:unreadCount`         | query         | public    | 2 ファイル      | あり              |
| `planInfo:check`                    | mutation      | public    | -               | あり              |
| `planInfo:compare`                  | mutation      | public    | -               | あり              |
| `planInfo:sync`                     | mutation      | internal  | -               | -                 |
| `presence:disconnect`               | mutation      | public    | 1 ファイル      | あり              |
| `presence:heartbeat`                | mutation      | public    | 1 ファイル      | あり              |
| `presence:list`                     | query         | public    | 1 ファイル      | あり              |
| `processing:cancel`                 | mutation      | public    | 1 ファイル      | あり              |
| `processing:cleanupCandidates`      | query         | internal  | -               | あり              |
| `processing:complete`               | mutation      | internal  | -               | あり              |
| `processing:create`                 | mutation      | public    | 1 ファイル      | あり              |
| `processing:expire`                 | mutation      | internal  | -               | あり              |
| `processing:fail`                   | mutation      | internal  | -               | あり              |
| `processing:figmaComplete`          | mutation      | internal  | -               | あり              |
| `processing:get`                    | query         | public    | 2 ファイル      | あり              |
| `processing:inspect`                | query         | internal  | -               | あり              |
| `processing:markCleaned`            | mutation      | internal  | -               | あり              |
| `processing:status`                 | query         | public    | 1 ファイル      | あり              |
| `processing:streamSession`          | mutation      | internal  | -               | あり              |
| `proofreading:claim`                | mutation      | public    | 1 ファイル      | あり              |
| `proofreading:fail`                 | mutation      | public    | 1 ファイル      | あり              |
| `proofreading:retry`                | mutation      | public    | 1 ファイル      | あり              |
| `proofreading:run`                  | query         | public    | 1 ファイル      | あり              |
| `proofreading:submit`               | mutation      | public    | 1 ファイル      | あり              |
| `push:config`                       | query         | public    | 1 ファイル      | あり              |
| `push:status`                       | query         | public    | 1 ファイル      | あり              |
| `push:subscribe`                    | mutation      | public    | 1 ファイル      | あり              |
| `push:unsubscribe`                  | mutation      | public    | 2 ファイル      | あり              |
| `reviews:complete`                  | mutation      | public    | 2 ファイル      | あり              |
| `reviews:myQueue`                   | query         | public    | -               | あり              |
| `reviews:setReviewers`              | mutation      | public    | 2 ファイル      | あり              |
| `revisions:closeExpired`            | mutation      | internal  | -               | -                 |
| `revisions:get`                     | query         | public    | 8 ファイル      | あり              |
| `revisions:markViewed`              | mutation      | public    | 1 ファイル      | あり              |
| `revisions:remindDeadlines`         | mutation      | internal  | -               | -                 |
| `seed:demo`                         | mutation      | internal  | -               | -                 |
| `semanticRules:current`             | query         | internal  | -               | -                 |
| `semanticRules:indexRule`           | action        | internal  | -               | -                 |
| `semanticRules:resolve`             | query         | internal  | -               | -                 |
| `semanticRules:search`              | action        | public    | 1 ファイル      | あり              |
| `semanticRules:store`               | mutation      | internal  | -               | -                 |
| `slackWorkspaces:add`               | mutation      | public    | 1 ファイル      | あり              |
| `slackWorkspaces:list`              | query         | public    | 1 ファイル      | あり              |
| `slackWorkspaces:remove`            | mutation      | public    | 1 ファイル      | あり              |
| `social:list`                       | query         | public    | 5 ファイル      | あり              |
| `social:remove`                     | mutation      | public    | 1 ファイル      | あり              |
| `social:save`                       | mutation      | public    | 1 ファイル      | あり              |
| `submissions:beginUpload`           | mutation      | internal  | -               | あり              |
| `submissions:completeUpload`        | mutation      | internal  | -               | あり              |
| `submissions:confirm`               | mutation      | public    | 1 ファイル      | あり              |
| `submissions:expireSessions`        | mutation      | internal  | -               | -                 |
| `submissions:failUpload`            | mutation      | internal  | -               | あり              |
| `submissions:get`                   | query         | public    | -               | あり              |
| `submissions:listOrphanObjects`     | mutation      | internal  | -               | あり              |
| `submissions:markObjectsPurged`     | mutation      | internal  | -               | あり              |
| `submissions:prepare`               | mutation      | public    | 1 ファイル      | あり              |
| `submissions:reset`                 | mutation      | public    | 1 ファイル      | あり              |
| `submissions:resumeUpload`          | mutation      | internal  | -               | あり              |
| `submissions:voidRevision`          | mutation      | public    | 1 ファイル      | あり              |
| `teams:importBatch`                 | mutation      | public    | 1 ファイル      | あり              |
| `teams:importDirectory`             | query         | public    | 1 ファイル      | あり              |
| `teams:list`                        | query         | public    | 5 ファイル      | あり              |
| `teams:remove`                      | mutation      | public    | 1 ファイル      | あり              |
| `teams:save`                        | mutation      | public    | 1 ファイル      | あり              |
| `users:avatars`                     | query         | public    | 1 ファイル      | あり              |
| `users:byIds`                       | query         | public    | 1 ファイル      | あり              |
| `users:search`                      | query         | public    | 1 ファイル      | あり              |
| `workMetrics:counts`                | query         | public    | -               | あり              |
| `works:changeLifecycle`             | mutation      | public    | -               | あり              |
| `works:create`                      | mutation      | public    | 1 ファイル      | あり              |
| `works:get`                         | query         | public    | 12 ファイル     | あり              |
| `works:importBatch`                 | mutation      | public    | 1 ファイル      | あり              |
| `works:importDirectory`             | query         | public    | 1 ファイル      | あり              |
| `works:listMine`                    | query         | public    | 1 ファイル      | あり              |
| `works:listMinePage`                | query         | public    | 1 ファイル      | あり              |
| `works:ogSummary`                   | query         | internal  | -               | あり              |
| `works:update`                      | mutation      | public    | 4 ファイル      | あり              |

## 起動と設定

### 手元

```
cd apps/cloudflare
pnpm dev --port 8790     # .dev.vars に AUTH_PRIVATE_KEY_JWK が無ければ作る。DEV_IDENTITY=allow で起こす
```

- 手元の本人の特定は 3 通り。Worker の JWT（サインイン済み）、Cloudflare Access の JWT、`X-MF100-Identity` ヘッダ（JSON。`pnpm dev` の `DEV_IDENTITY:allow` のときだけ）。設定ファイルの既定は `deny`。
- 手元のサインインは Nogiku のモック（`pnpm dev` が `--var NOGIKU_MOCK_ENABLED:true` で有効にする。設定ファイルの既定は `false`。`POST /auth/mock`）。
- web は `cd apps/web && pnpm dev:cloudflare`（`vp dev --mode cloudflare`）か `pnpm build:cloudflare`。Worker の URL は `VITE_CLOUDFLARE_URL`（既定 `http://localhost:8790`）。ビルドに焼き込まれる。
- api は `BACKEND=cloudflare` と `CLOUDFLARE_SITE_URL`（Worker の `SITE_URL` と同じ値）で Worker を向く。既定は `convex`。JWT の `aud` は `convex` のまま、issuer と JWKS の向き先だけが変わる。

### env と secret

名前は Convex 側と同じ（値をそのまま持ってこられる）。秘密は `wrangler secret put` か手元の `.dev.vars`。`wrangler.jsonc` の `vars` は手元の既定で、本番の環境（`env.production`）はまだ無い（DO の binding と vars は環境に引き継がれないので、足すときに書き直す）。

| 名前                                                                           | 種類   | 用途                                                                                                                                   |
| ------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                                                     | var    | この Worker の origin。JWT の iss、OIDC の redirect_uri（`${SITE_URL}/auth/callback`）、JWKS                                           |
| `FRONTEND_URL`                                                                 | var    | サインイン後に戻す web の origin。メール・Slack のリンクの前につく                                                                     |
| `ALLOWED_ORIGINS`                                                              | var    | CORS で許す origin（カンマ区切り）                                                                                                     |
| `DEV_IDENTITY`                                                                 | var    | `allow` のときだけ `X-MF100-Identity` を受ける。本番は `deny`                                                                          |
| `MF100_SYSTEM_ADMIN_SUBJECTS`                                                  | var    | 初回ログインで校正システム管理者にする Nogiku の sub（カンマ区切り）                                                                   |
| `NOGIKU_MOCK_ENABLED`                                                          | var    | `true` でモックのサインインだけが使える。本番は必ず `false`                                                                            |
| `AUTH_PRIVATE_KEY_JWK`                                                         | secret | ES256 の秘密鍵（JWK）。`node scripts/auth-keygen.mjs` が出す                                                                           |
| `NOGIKU_CLIENT_ID` / `NOGIKU_CLIENT_SECRET` / `NOGIKU_ISSUER`                  | secret | Nogiku の OIDC。`${NOGIKU_ISSUER}/.well-known/openid-configuration` を読む                                                             |
| `NOGIKU_ACCESS_API_URL` / `NOGIKU_ACCESS_ORG_SLUG` / `NOGIKU_ACCESS_SYSTEM_ID` | secret | 組織権限。3 つ揃ったときだけ有効（`NOGIKU_ACCESS_ENABLED` で切る）                                                                     |
| `ACCESS_TEAM` / `ACCESS_AUDIENCE`                                              | secret | Cloudflare Access で守るとき                                                                                                           |
| `MF100_UPLOAD_SECRET`                                                          | secret | apps/api が提出・添付の転送で使う。16 文字以上。`X-MF100-Service-Key` で渡る                                                           |
| `MF100_CLEANUP_SECRET`                                                         | secret | R2 の清掃。16 文字以上。Bearer                                                                                                         |
| `MF100_IMPORT_SECRET`                                                          | secret | `/internal/import`（データ移行の間だけ）。清掃の秘密とは分ける（apps/api が持つ秘密で管理者の行を書けないように）。16 文字以上。Bearer |
| `PROCESSING_SECRET`                                                            | secret | `/internal/processing`。32 文字以上。Bearer                                                                                            |
| `PROCESSING_ENABLED` / `PROCESSING_CAPABILITIES`                               | var    | ファイル処理を受けるか（`true`）と、受ける kind（カンマ区切り）                                                                        |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`                     | secret | Web Push。揃わなければ送らない                                                                                                         |
| `RESEND_API_KEY` / `NOTIFY_EMAIL_FROM`                                         | secret | メール。`FRONTEND_URL` も要る                                                                                                          |
| `SLACK_BASE_URL`                                                               | secret | Slack（めいちゃん）の入口。`FRONTEND_URL` も要る                                                                                       |
| `AI_PROVIDER` / `AI_MODEL` / `AI_MAX_CHARS` / `AI_PROOFREAD_ENABLED`           | var    | AI 校正。提供元は `anthropic`（既定）か `workers-ai`。`AI_PROOFREAD_ENABLED=false` で止める                                            |
| `ANTHROPIC_API_KEY` / `AI_GATEWAY_URL`                                         | secret | Anthropic のキーと、経由する Gateway                                                                                                   |
| `WORKERS_AI_URL` / `WORKERS_AI_SECRET`                                         | secret | apps/api の `/internal/ai/*`（Workers AI の代理と埋め込み）。32 文字以上                                                               |
| `RULE_EMBEDDINGS_ENABLED`                                                      | var    | `true` のときだけルールの埋め込みの索引づけを積む                                                                                      |

サービス秘密が未設定・短いときは、それで守られた関数と口が 404 になる（在ることも教えない）。

## 切り替えの手順

当面の本番は Convex。以下は切り替えを決めたときの順で、どれも未実施。

1. Worker を用意する。`wrangler.jsonc` に `env.production`（DO の binding、migrations、vars、cron）を書き、上の表の secret を `wrangler secret put` で入れる。`NOGIKU_MOCK_ENABLED` は `false`、`DEV_IDENTITY` は `deny`。`MF100_UPLOAD_SECRET` / `MF100_CLEANUP_SECRET` は Convex 側と同じ値を使う。
2. Nogiku に redirect_uri `${SITE_URL}/auth/callback` を登録する。
3. 過去データを移す（下。**利用者の明示承認を得てから**）。
4. apps/api の `BACKEND` を `cloudflare`、`CLOUDFLARE_SITE_URL` を Worker の `SITE_URL` にして deploy する。`staging` と `production` の vars には既定で書いていない（無ければ `convex`）。
5. web を `VITE_CLOUDFLARE_URL=<SITE_URL> vp build --mode cloudflare` でビルドして配信する。
6. 取り込みの口（`src/app.ts` の `importApp` の 1 行）を外して Worker を deploy し直す。口は専用の `MF100_IMPORT_SECRET` で守られている。移行が済んだら秘密を消し、口も外す。
7. 戻すときは `BACKEND` を `convex` に戻し、web を Convex 向けにビルドし直す。切り替え後に Cloudflare へ書いた分は Convex に戻らない。

## データ移行

道具は `src/migrate`（変換・取り込み・派生表の作り直し・確認）と `scripts/migrate`（export の変換・送信）。Convex にも Cloudflare にも自分では通信しない（送信だけが `/internal/import` を呼ぶ）。

過去データの移行は利用者の明示承認まで行わない。道具は手元の偽データのテスト（`src/migrate.test.ts`）でだけ動かしてあり、本物の export は取っていない。

手順（承認後）。

1. 静かな時間に Convex の export を取る（人が自分の端末で。ファイル本体の `_storage` は要らない）。
   `cd apps/convex && npx convex export --prod --path ../cloudflare/snapshot.zip`
2. 変換する。対応表に無い場所があれば何も書かずに 1 で止まる。
   `node scripts/migrate/export-convex.mjs --zip snapshot.zip --out snapshot.jsonl`
3. 塊の数と大きさを見る（送らない）。
   `SITE_URL=... MF100_IMPORT_SECRET=... node scripts/migrate/import-to-worker.mjs snapshot.jsonl --dry-run`
   続けて `wrangler dev` か Preview の空の Worker に、同じコマンドから `--dry-run` を外して通しで流して確かめる。
4. 空の本番の Worker へ同じように流す。1000 行か約 4 MB ごとの塊で送り、最初の塊で keyless の表（grants / approvals / ruleRevisions / audit）を空にし、最後の塊で派生表を作り直して確認（verify）を返す。何度流しても同じ結果になる。
5. verify の問題が 0 件になるまで直す。確認は件数・users の本人の特定（subject）・参照の欠け・進行中の仕事・派生表の欠けを見る。
6. 切り替えの手順の 4 以降へ進む。

`snapshot.zip` と `snapshot.jsonl` には実データが入る。リポジトリに置かない。

- 取り込み先は、切り替え前の、まだ誰もサインインしていない空の DO が前提。先にサインインした人が同じ subject を別の id で持っていると、その行は取り込まない（`subject-taken-by-other-id`）。
- 移さない表: 認証の状態（再サインインさせる）、AI の一時結果、Web Push の二重送り防止、集計・在席・rate limit・workpool・workflow の内部、`_storage`。`dashboardLayouts` と `recentWorks` は Cloudflare に表が無く、使っていないので移さない。
- 移さず作り直す表: `workSummaries` / `workRoles` / `workSearch` / `notificationCounters`。
- 進行中の仕事（`processingJobs` の queued / running、open の `uploadSession`）は Convex の workpool・workflow に結び付いていて、移しても続きは動かない。切り替えは静かな時間に行い、verify の inflight で数を確かめる。

## 残る差と制限

実装に残っている `ponytail:`（意図して省いたもの）を、場所と一緒に載せる。`grep -rn "ponytail:" apps/cloudflare apps/api/src apps/web/src/cloudflare` で集めた。

規模・性能。

| 場所                                | 内容                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/db.ts`                         | DO 1 つ。書き込みが全体で直列。足りなくなったら年度や制作物で分ける                                        |
| `apps/web/src/cloudflare/client.ts` | 購読の粒度は表。行や列では絞らない。最初の読み取りが終わるまでは念のため読み直す                           |
| `src/sqlite/context.ts`             | OFFSET の頁送り（締切の窓）は後ろの頁ほど遅い。数千件を超えたら `(deadlineAt, id)` の keyset にする        |
| `src/functions/semanticRules.ts`    | ルールの検索は全件を読んで JS でコサイン類似度。千を超えたら Vectorize か、先に ACL と版で絞る             |
| `src/functions/admin.ts`            | 監査の絞りは全件の `json_extract`（audit は列も index も持たない）。増えたら列を足す                       |
| `src/functions/home.ts`             | `home:submitTargets` は進行中を全件渡す。権限は `listSubmitTargets` が確かめるので結果は同じで、読みが多い |
| `src/jobs.ts`                       | 同時に動かすのは古い順の先頭の kind だけ（別の kind とは混ぜない）。数が増えたら待ち行列にする             |
| `src/delivery/deliver.ts`           | 通知の送信の枠は省略するとすぐ送る。並べて送るなら alarm 側が渡す                                          |
| `src/collab/store.ts`               | 在席の行は心拍が無ければ残る（一覧は期限で絞るので見えない）。共同編集のステップの件数に上限は無い         |
| `src/rateLimit.ts`                  | Convex は窓の始まりを乱数でずらす。ここは最初に使った時刻                                                  |

認証。

| 場所                                         | 内容                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/auth/jwt.ts`                            | 署名鍵は 1 本。回すときは JWKS に新旧 2 本を載せて、発行を新しい方へ切り替える      |
| `src/auth/store.ts`                          | 使用済みの refresh が再び来ても、セッション全体は失効させない（盗用の検知は未対応） |
| `src/auth/oidc.ts`                           | discovery を呼ぶたびに取りに行く（ログインのときだけ）                              |
| `src/auth/access.ts`、`src/auth/redirect.ts` | Convex 側と二重管理。Convex を畳むときにこちらへ一本化する                          |

Convex との違い。

| 場所                                        | 内容                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/jobs.ts`                               | `feedbackMigration`（Convex の手動起動の移行）は関数を移していないので kind を持たない                            |
| `src/sqlite/schema.ts`                      | 既にある表へ列は足さない。手元の `.wrangler/state` が古ければ消す（本番の DO はまだ無い）                         |
| `src/sqlite/derived.ts`                     | `workAggregateEntries` は持たず、`works` を `GROUP BY` で数える                                                   |
| `src/sqlite/context.ts`                     | `BEGIN` しない（呼び出し側の DO が 1 トランザクションを保つ）。名簿は subject の無い行も除かない（テストの土台）  |
| `src/functions/workList.ts`                 | Convex の `rolesVersion` の無い古い行を含める枝は持たない                                                         |
| `src/functions/users.ts`                    | `resolveUsers` の Map は引数の順（Convex は system / bot を先に入れる。画面は ID で引くので順に依らない）         |
| `src/functions/collaboration.ts`            | 切り替えを忘れた画面のバグは Convex と同じく素の Error（500）                                                     |
| `src/functions/define.ts`                   | domain のコード表に無い失敗は `reject` で code のまま返す（cast）。表に足せたものから足す。zod の型の橋も cast    |
| `src/ai/provider.ts`                        | AI 校正の既定モデルは Sonnet（Convex は opus）。`AI_MODEL` で替える                                               |
| `apps/api/src/adapters/processingClient.ts` | Cloudflare の `processing:get` の戻りは Convex と形が違い得る。使うのは state と output だけなので型を寄せて cast |

データ移行。

| 場所                                   | 内容                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app.ts`、`src/migrate/route.ts`   | 取り込みが済んだら `/internal/import` の組み込み 1 行を外す（本番に残さない）                                                         |
| `src/migrate/plan.ts`                  | 進行中の仕事は移さない（上）。変換は全部をメモリに載せる（数 GB を超えるなら場所ごとに流す。今は数十 MB）                             |
| `src/migrate/rebuild.ts`               | 派生表の作り直しは 1 回の呼び出しで全件。制作物が数万を超えたら `works` の rowid で区切って分ける                                     |
| `src/sqlite/context.ts`                | 移行専用の読み取りは OFFSET で数える                                                                                                  |
| `scripts/migrate/export-convex.mjs`    | component の表の場所（`_components/prosemirrorSync/...`）は推定で、本物の export で確かめていない。違えば「対応表に無い場所」で止まる |
| `scripts/migrate/import-to-worker.mjs` | 失敗した塊の再送は人が全体をやり直す（冪等）。塊ごとの再試行は無い                                                                    |

そのほか。

- web: `vp dev --mode cloudflare` 相手の E2E は M3E の select が開かないことがあり、Lit の class-field-shadowing のエラーで落ちる（原因は未確定）。E2E は `vp build` + `vp preview` で流す。通信の失敗は黙って待ち、WebSocket の張り直しか次の通知で読み直す。
- 差分テストの許可表: 派生表の版の印（`*Version`）、不透明な cursor、audit の行の id。
- 購読者に配らない表（`jobs` / `meta` / `rateLimits` / `idempotency` / `ruleEmbeddings`）は `src/run.ts` の `SILENT_TABLES` の 1 か所で決める。書いても配らず、読みにも数えない。
