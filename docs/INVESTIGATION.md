# 既存資産の調査結果（Phase 0）

調査日: 2026-10-10。対象: MF99 UniQ（`UniQ-develop.zip`）、Nogiku（`nogiku-develop.zip`）、`@m3e/react`、VoidZero（Vite+）、Convex。

## 1. UniQ の Nogiku × Convex 連携（再利用した）

| 項目             | UniQ での実装                                                                                                                                                                                                  | MF100 での扱い                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 認証ライブラリ   | `@convex-dev/auth`（Convex Auth）+ `@auth/core`                                                                                                                                                                | 同じ。`apps/convex/convex/auth.ts`                                                                                 |
| Nogiku provider  | 独自 OIDC provider（`convex/providers/nogiku.ts`）。`type: "oidc"`, `checks: ["pkce","state","nonce"]`, **`idToken: false`**（userinfo を必ず取得）。discovery は `${issuer}/.well-known/openid-configuration` | 同形で移植（`convex/providers/nogiku.ts`）。`roles` 依存を外した                                                   |
| コールバック URL | `${CONVEX_SITE_URL}/api/auth/callback/nogiku` を Nogiku 側に登録                                                                                                                                               | 同じ。Nogiku 管理者作業                                                                                            |
| モック           | `NOGIKU_MOCK_ENABLED=true` で `ConvexCredentials` provider（id は同じ `"nogiku"`）。固定 1 ユーザー                                                                                                            | 同方式。`sub/name/email` を引数で受け、複数の役割を切替可能にした                                                  |
| 認可             | `users.source === "nogiku"` で委員判定。`roles[].permission === "MANAGE"` を `NOGIKU_SYSTEM_ID` で絞って `admin` 付与。`customQuery/customMutation`（convex-helpers）で `cmsQuery` 等                          | MF100 は組織権限ではなく**作品単位の職責＋個人 ACL**で判定（C10）。システム管理者は env ブートストラップ＋管理画面 |
| JWT 検証設定     | `auth.config.ts`: `domain: CONVEX_SITE_ORIGIN, applicationID: "convex"`                                                                                                                                        | 同じ。Hono 側も同 issuer/audience で検証                                                                           |
| フロント         | `ConvexAuthProvider` + `useConvexAuth` + `_cmsProtected` ガード（認可確定まで子を描かない）                                                                                                                    | 同パターン（`_app.tsx`）                                                                                           |
| 運用             | Convex セルフホスト（`CONVEX_SELF_HOSTED_URL` / `ADMIN_KEY`）、Cloudflare Pages、GitHub Actions                                                                                                                | 参考。MF100 は Cloud 無料枠を第一候補（D11 未決）                                                                  |
| 開発ツール       | TanStack Start、Panda CSS、Biome、vitest + `edge-runtime`、convex-test                                                                                                                                         | MF100 は Vite+（Oxlint/Oxfmt/Vitest 5）。convex-test の `edge-runtime` 構成は踏襲                                  |

## 2. Nogiku（develop）で確認した事実

- **Nogiku Auth**（`apps/auth`）: better-auth + `@better-auth/oauth-provider`。issuer は `${HOST}${BASE_PATH}/api`。エンドポイント `/api/oauth2/authorize|token|userinfo`、JWKS `/api/jwks`、discovery `/api/.well-known/openid-configuration`。
- スコープ: `openid`, `profile`, `email`, `offline_access`。
- **userinfo の追加クレーム**（`customUserInfoClaims`）: `name, email, hurigana, phoneNumber, generation, role`。**`roles[]` は含まれない。** UniQ が参照していた `roles`（system 単位の ACCESS/MANAGE）は旧仕様か別経路であり、現行 develop のコードには無い。→ MF100 は `roles` に依存しない設計にした。
- **Nogiku Access**（`apps/access-engine` `/api`）: Bearer JWT（`iss` = Nogiku Auth、`aud` = Access API 自身の URL）を JWKS で検証。`POST /permission/check {permissions[], systemId, organization} → {valid, missing}`（scope `permissions.read`）、`GET /member/{nogikuId}?organization=`（scope `users.read`、役職一覧を返す）。アクセストークンを JWT で得るには認可リクエストに `resource` を付ける必要がある。
- **NAPS**（`/.well-known/permissions`）: 連携システムが権限名を宣言し、Nogiku Access が同期する仕組み。MF100 の権限（例: `works:manage`）を将来宣言する候補。
- Access Studio 自身が RP として `genericOAuth`（better-auth）で Nogiku Auth にログインしている実装（`apps/access-engine/src/studio/lib/auth/auth.ts`）が、MF100 以外の RP 実装例として参考になる。

### 後続（グループ・役職連動）への含意

`Principal.groupIds` に Nogiku Access から得たグループ ID を入れれば、既存の `effectivePermission` が `principalType: "group"` の付与を評価する。取得経路は (a) ログイン時に `offline_access` + `resource` でアクセストークンを得て `/member/{sub}` と `/permission/check` を呼ぶ、(b) 定期同期、のいずれか。失効伝播と手動 ACL との優先順位は D3 細則で決める。

## 3. `@m3e/react` 2.9.2（Material 3 Expressive）

- 実在を確認（npm、MIT、個人メンテナ matraic、`@m3e/web` の Lit Web Components を `@lit/react` でラップ。`react >= 18` peer）。サブパス import 必須（`@m3e/react/button` 等）。
- 採用: Button / IconButton / Icon / Theme / AppBar / NavRail / NavItem / Card / Dialog / FilterChip(Set) / List / Tabs / Badge / Tooltip / Progress / Divider / Heading / Snackbar（60 系統中）。
- 無いもの: **データテーブル、テキスト入力の React 向け簡易 API**。校正用テーブルとフォーム入力は M3 トークン（`--md-sys-color-*` フォールバック付き）で補完した（`apps/web/src/styles.css`, `ui/Field.tsx`）。
- リスク: コミュニティ実装でリリース頻度が高い（3 日前に 2.9.2）。バージョンは固定し、`ui/m3e.ts` に import を集約して差し替え点を 1 箇所にした。

## 4. VoidZero / Vite+（`vite-plus` 1.2.0）

- 単一 devDependency で Vite 8.3 / Rolldown 1.2 / Vitest 5.0 / Oxlint 1.88 / Oxfmt 0.73 / tsdown 0.23 / Vite Task を提供（1.2.0 は 2026-10-16 に 1.1.0 から更新）。`vp check`（fmt+lint+型）、`vp test`、`vp build`、`vp run -r`（ワークスペース・キャッシュ）を使用。
- Vitest API は `vite-plus/test` から import（各パッケージが `vite-plus` を devDependency に持つ）。
- プラグインや依存が直接読む `vite`・`vitest` は Vite+ のものにそろえる（Vite+ の docs/guide/local-cli.md の推奨）: `pnpm-workspace.yaml` の overrides に `vite@*: npm:@voidzero-dev/vite-plus-core@<vite-plus の版>` と `vitest@*: <vp toolchain vitest の版>`、`apps/web` の devDependencies にも `vite` の同じ別名（プラグインの peer がこれで解決する）。別の vite が入ると Plugin の型が二重になり、1.2.0 の型を使う lint が vite.config.ts で「型の比較が深すぎる」（TS2321）で止まった。**vite-plus を上げるときは、この 3 か所の版も一緒に上げる**
- 注意: 型チェックは tsgolint（TypeScript Go）。Convex の `convex codegen --typecheck` は `tsc` を使うため `typescript@5.9.3` も併置。

## 5. Convex 1.46

- `npx convex codegen` は dev deployment（ログイン or `CONVEX_DEPLOY_KEY`）を要求し、この環境では実行できなかった。公式テンプレートと同形式の `_generated` を生成する `apps/convex/scripts/codegen.mjs` を用意し、コミットしている。`npx convex dev` 実行で上書きされる。
- `convex-test` 0.0.61 は deployment 不要。Convex Auth の identity は `subject = "<userId>|<sessionId>"` なので、テストでは `t.withIdentity({ subject })` で偽装（`apps/convex/test/harness.ts`）。
- このセッションでは利用者の Convex アカウントに接続していない。接続には `npx convex dev`（対話ログイン）か `CONVEX_DEPLOY_KEY`（環境シークレット）が必要。
