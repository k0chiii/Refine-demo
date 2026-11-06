# 現状の根拠

調査日: 2026-10-22。HEAD: `f4fa9653a341e1f37ea4740b1e2ec0b1b4391c01`。ローカルの未コミット変更を含む。

クラウドの設定・ログ・請求・実データは取得していない。速度と費用は今回実測していない。

## package.json

- [package.json:8](../../package.json#L8) — `"check": "vp check",`
- [package.json:12](../../package.json#L12) — `"typecheck": "vp run -r typecheck",`
- [package.json:13](../../package.json#L13) — `"build": "vp run -r build",`
- [package.json:14](../../package.json#L14) — `"dev": "node scripts/dev.mjs",`
- [package.json:23](../../package.json#L23) — `"vite-plus": "1.2.0"`

## vite.config.ts

- [vite.config.ts:9](../../vite.config.ts#L9) — `defaultPackage: "./apps/web",`
- [vite.config.ts:36](../../vite.config.ts#L36) — `typeAware: true,`
- [vite.config.ts:6](../../vite.config.ts#L6) — `* - test.projects で各パッケージの Vitest 設定を束ね、`vp test` 一発で全テストを実行する。`
- [vite.config.ts:44](../../vite.config.ts#L44) — `projects: ["packages/*", "apps/convex", "apps/api", "apps/web"],`

## .github/workflows/ci.yml

- [.github/workflows/ci.yml:39](../../.github/workflows/ci.yml#L39) — `node-version: 22`
- [.github/workflows/ci.yml:67](../../.github/workflows/ci.yml#L67) — `node-version: 22`
- [.github/workflows/ci.yml:109](../../.github/workflows/ci.yml#L109) — `node-version: 22`
- [.github/workflows/ci.yml:45](../../.github/workflows/ci.yml#L45) — `run: pnpm build`
- [.github/workflows/ci.yml:1](../../.github/workflows/ci.yml#L1) — `# CI: 変更ごとに、手元で回しているのと同じ確認を走らせる（CLAUDE.md: pnpm check / pnpm test / pnpm typecheck）。`
- [.github/workflows/ci.yml:47](../../.github/workflows/ci.yml#L47) — `run: pnpm check`
- [.github/workflows/ci.yml:1](../../.github/workflows/ci.yml#L1) — `# CI: 変更ごとに、手元で回しているのと同じ確認を走らせる（CLAUDE.md: pnpm check / pnpm test / pnpm typecheck）。`
- [.github/workflows/ci.yml:50](../../.github/workflows/ci.yml#L50) — `run: pnpm typecheck`
- [.github/workflows/ci.yml:1](../../.github/workflows/ci.yml#L1) — `# CI: 変更ごとに、手元で回しているのと同じ確認を走らせる（CLAUDE.md: pnpm check / pnpm test / pnpm typecheck）。`
- [.github/workflows/ci.yml:52](../../.github/workflows/ci.yml#L52) — `run: pnpm test`
- [.github/workflows/ci.yml:71](../../.github/workflows/ci.yml#L71) — `run: pnpm --filter @mf100/web build:demo`
- [.github/workflows/ci.yml:113](../../.github/workflows/ci.yml#L113) — `run: pnpm --filter @mf100/web build:demo`
- [.github/workflows/ci.yml:172](../../.github/workflows/ci.yml#L172) — `run: pnpm --filter @mf100/web build:demo`

## .github/workflows/deploy.yml

- [.github/workflows/deploy.yml:81](../../.github/workflows/deploy.yml#L81) — `environment: production`
- [.github/workflows/deploy.yml:100](../../.github/workflows/deploy.yml#L100) — `run: pnpm exec convex deploy --cmd "pnpm --filter @mf100/web build" --cmd-url-env-var-name VITE_CONVEX_URL`
- [.github/workflows/deploy.yml:106](../../.github/workflows/deploy.yml#L106) — `run: pnpm exec wrangler deploy --env production`
- [.github/workflows/deploy.yml:74](../../.github/workflows/deploy.yml#L74) — `run: pnpm exec wrangler pages deploy ../web/dist-demo --project-name mf100-refine-demo --branch "$BRANCH" --commit-dirty=true`
- [.github/workflows/deploy.yml:112](../../.github/workflows/deploy.yml#L112) — `run: pnpm exec wrangler pages deploy ../web/dist --project-name mf100-refine --branch main`

## apps/web/vite.config.ts

- [apps/web/vite.config.ts:14](../../apps/web/vite.config.ts#L14) — `function ocrAssets(): Plugin {`
- [apps/web/vite.config.ts:58](../../apps/web/vite.config.ts#L58) — `function pwa(): Plugin {`
- [apps/web/vite.config.ts:151](../../apps/web/vite.config.ts#L151) — `autoCodeSplitting: true,`
- [apps/web/vite.config.ts:102](../../apps/web/vite.config.ts#L102) — `function preconnect(): Plugin {`
- [apps/web/vite.config.ts:156](../../apps/web/vite.config.ts#L156) — `preconnect(),`

## apps/api/wrangler.jsonc

- [apps/api/wrangler.jsonc:3](../../apps/api/wrangler.jsonc#L3) — `"name": "mf100-api",`
- [apps/api/wrangler.jsonc:31](../../apps/api/wrangler.jsonc#L31) — `"name": "mf100-api",`
- [apps/api/wrangler.jsonc:7](../../apps/api/wrangler.jsonc#L7) — `"observability": { "enabled": true },`
- [apps/api/wrangler.jsonc:9](../../apps/api/wrangler.jsonc#L9) — `"triggers": { "crons": ["23 * * * *"] },`
- [apps/api/wrangler.jsonc:10](../../apps/api/wrangler.jsonc#L10) — `"r2_buckets": [`
- [apps/api/wrangler.jsonc:32](../../apps/api/wrangler.jsonc#L32) — `"r2_buckets": [{ "binding": "ASSETS", "bucket_name": "mf100-assets" }],`
- [apps/api/wrangler.jsonc:30](../../apps/api/wrangler.jsonc#L30) — `"production": {`

## apps/api/src/env.ts

- [apps/api/src/env.ts:2](../../apps/api/src/env.ts#L2) — `export interface Bindings {`

## apps/api/src/app.ts

- [apps/api/src/app.ts:263](../../apps/api/src/app.ts#L263) — `const serve = async (access: ArtifactAccess, req: Request) => {`
- [apps/api/src/app.ts:255](../../apps/api/src/app.ts#L255) — `* - ブラウザの HTTP キャッシュには残さない（`private, no-store`）。権限剥奪後にキャッシュから読めないため（§9.1 / A-11）。`
- [apps/api/src/app.ts:275](../../apps/api/src/app.ts#L275) — `: "private, no-store, no-transform",`
- [apps/api/src/app.ts:273](../../apps/api/src/app.ts#L273) — `"Cache-Control": access.cacheable`

## apps/api/src/figmaImport.ts

- [apps/api/src/figmaImport.ts:30](../../apps/api/src/figmaImport.ts#L30) — `const MAX_ITEMS = 50;`
- [apps/api/src/figmaImport.ts:56](../../apps/api/src/figmaImport.ts#L56) — `const valid = items.slice(0, MAX_ITEMS).filter((it) => {`
- [apps/api/src/figmaImport.ts:67](../../apps/api/src/figmaImport.ts#L67) — `const withRetry = async <T>(fn: () => Promise<T>): Promise<T> => {`
- [apps/api/src/figmaImport.ts:85](../../apps/api/src/figmaImport.ts#L85) — `meta = await withRetry(() => deps.figma.getNodes(fileKey, ids));`
- [apps/api/src/figmaImport.ts:86](../../apps/api/src/figmaImport.ts#L86) — `images = await withRetry(() => deps.figma.renderImages(fileKey, ids, deps.scale));`
- [apps/api/src/figmaImport.ts:116](../../apps/api/src/figmaImport.ts#L116) — `const bytes = await deps.figma.download(url);`

## apps/api/src/index.ts

- [apps/api/src/index.ts:26](../../apps/api/src/index.ts#L26) — `async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {`
- [apps/api/src/index.ts:45](../../apps/api/src/index.ts#L45) — `async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {`

## apps/convex/convex/works.ts

- [apps/convex/convex/works.ts:349](../../apps/convex/convex/works.ts#L349) — `export const listMine = query({`
- [apps/convex/convex/works.ts:430](../../apps/convex/convex/works.ts#L430) — `const WORKS_SCAN_LIMIT = 2000;`
- [apps/convex/convex/works.ts:441](../../apps/convex/convex/works.ts#L441) — `export async function listMyWorks(`
- [apps/convex/convex/works.ts:163](../../apps/convex/convex/works.ts#L163) — `const users = await ctx.db.query("users").take(5000);`

## apps/convex/convex/schema.ts

- [apps/convex/convex/schema.ts:244](../../apps/convex/convex/schema.ts#L244) — `.searchIndex("search_title", { searchField: "title", filterFields: ["year", "lifecycle"] }),`
- [apps/convex/convex/schema.ts:247](../../apps/convex/convex/schema.ts#L247) — `workRoles: defineTable({`
- [apps/convex/convex/schema.ts:582](../../apps/convex/convex/schema.ts#L582) — `documentDrafts: defineTable({`
- [apps/convex/convex/schema.ts:864](../../apps/convex/convex/schema.ts#L864) — `idempotencyKeys: defineTable({`

## apps/convex/convex/documents.ts

- [apps/convex/convex/documents.ts:45](../../apps/convex/convex/documents.ts#L45) — `export const save = mutation({`
- [apps/convex/convex/documents.ts:65](../../apps/convex/convex/documents.ts#L65) — `export const writable = query({`

## apps/convex/convex/ai.ts

- [apps/convex/convex/ai.ts:106](../../apps/convex/convex/ai.ts#L106) — `export const proofread = action({`
- [apps/convex/convex/ai.ts:132](../../apps/convex/convex/ai.ts#L132) — `const raw = await provider.proofread({ text, rules: prep.rules });`

## apps/convex/convex/pushNode.ts

- [apps/convex/convex/pushNode.ts:12](../../apps/convex/convex/pushNode.ts#L12) — `export const deliver = internalAction({`
- [apps/convex/convex/pushNode.ts:20](../../apps/convex/convex/pushNode.ts#L20) — `for (const target of plan.targets) {`

## apps/convex/convex/feedbackMigration.ts

- [apps/convex/convex/feedbackMigration.ts:40](../../apps/convex/convex/feedbackMigration.ts#L40) — `const TIME_BUDGET_MS = 5 * 60_000;`
- [apps/convex/convex/feedbackMigration.ts:167](../../apps/convex/convex/feedbackMigration.ts#L167) — `export const run = internalAction({`

## apps/convex/convex/lib/adapters.ts

- [apps/convex/convex/lib/adapters.ts:542](../../apps/convex/convex/lib/adapters.ts#L542) — `await scheduler.runAfter(0, internal.pushNode.deliver, { notificationId: id });`
- [apps/convex/convex/lib/adapters.ts:570](../../apps/convex/convex/lib/adapters.ts#L570) — `async countUnread(userId) {`
- [apps/convex/convex/lib/adapters.ts:1018](../../apps/convex/convex/lib/adapters.ts#L1018) — `idempotency: {`

## apps/web/src/demo/convexReact.ts

- [apps/web/src/demo/convexReact.ts:52](../../apps/web/src/demo/convexReact.ts#L52) — `export function useMutation(ref: FunctionReference<"mutation">) {`
- [apps/web/src/demo/convexReact.ts:56](../../apps/web/src/demo/convexReact.ts#L56) — `export function useAction(ref: FunctionReference<"action">) {`

## packages/domain/src/revision/UploadSession.ts

- [packages/domain/src/revision/UploadSession.ts:100](../../packages/domain/src/revision/UploadSession.ts#L100) — `export const MAX_UPLOAD_BYTES = 100 * 1000 * 1000;`

## packages/domain/vite.config.ts

- [packages/domain/vite.config.ts:9](../../packages/domain/vite.config.ts#L9) — `pack: {`

## docs/CI_CD.md

- [docs/CI_CD.md:40](../../docs/CI_CD.md#L40) — `| PR                    | 5 分 05 秒（Smoke E2E 5 分 05 秒・verify 2 分 12 秒）                                  | **2 分 34 秒**（verify 2 分 32 秒・e2e-smoke 1 分 50 秒。律速は verify）                                                                                               |`
- [docs/CI_CD.md:21](../../docs/CI_CD.md#L21) — `e-dash の記事（CI を 18 分 → 4 分台）に倣い、まず時間を分けて測った。記事で効いた Vitest のワーカー・DB の初期化のキャッシュ・node_modules のキャッシュは、ここでは効かない（依存の導入は 9 秒、デモ版のビルドは 5 秒、単体テストは 15 秒前後）。遅いのは E2E の中身だけだった。`

## docs/COST.md

- [docs/COST.md:140](../../docs/COST.md#L140) — `- **`workRoles`（職責の派生表）で `home.submitTargets` を引く**: 全制作物の読み取りが 0.47MB → 数 KB になる大きな効果があるが、本番のデータで同期が取れているかを確かめる（最悪は埋め直し）必要がある。確認できないので見送り（推奨 4）。`
- [docs/COST.md:150](../../docs/COST.md#L150) — `| 4   | **`home.submitTargets` を `workRoles.by_user` で引く**（自分が制作者の制作物だけ読む）。現状は全制作物の文書（450KB）を読む                                                                                                                                                                                                                         | 常時購読 0.47MB → 数 KB。シェルの購読が制作物の書込みで再実行されなくなる                                                                                       | 小〜中。**本番の `workRoles` が works と同期しているかの確認が先**（書込み時の同期は `lib/adapters.ts:104` にあるが、導入前の制作物が欠けていないか）。欠けていれば埋め直しが要る         |`
- [docs/COST.md:172](../../docs/COST.md#L172) — `| Convex ダッシュボード → Settings → Billing               | **利用上限（Spending limit）と通知の閾値**を設定する。DB 帯域と関数呼び出しの使用量が上限の 50% / 80% を超えたら通知。プランの上限・単価はこの画面で確認する                                        |`
- [docs/COST.md:4](../../docs/COST.md#L4) — `**画面・文言・読み込み中の表示・認可・ファイルのキャッシュ方針（`Cache-Control: private, no-store`）は変えていない。** 変えたのは「読む量・呼ぶ回数・取り直す量」だけ。`
- [docs/COST.md:134](../../docs/COST.md#L134) — `- **`Cache-Control` を公開キャッシュ可にする／Cloudflare のキャッシュ（`cf.cacheEverything` や Cache API）に認可つきのファイルを載せる**: 採らない（A-11。前回の変更と同じ）。`

