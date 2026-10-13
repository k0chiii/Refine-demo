# MF100 校正システム（refine）

東京大学五月祭常任委員会 MF100 の制作物校正・校了を一周させる Web/PWA システム。要件の正本は [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)（v1.1）。

> 状態: **MVP 実装中・制度承認前**。D1（新版提出確定で旧版受付終了）と D4（過年度移行の延期）は決定済み。D2（自己校了・合議）と D3（公開範囲細則）は承認待ちで、コード上はポリシー値として差し替え可能にしてある。本番デプロイ・課金・過去データ移行・既存環境変更は行っていない。

## 画面

主要画面のスクリーンショットは [`docs/SCREENSHOTS.md`](docs/SCREENSHOTS.md)。バックエンド無しで触れるデモモード: `cd apps/web && pnpm dev:demo`。

## 構成（DDD / Clean Architecture）

```
packages/domain        業務ルールの純粋 TypeScript（依存ゼロ）: Work / Revision / UploadSession / CommentThread / Approval / ACL
packages/application   ユースケース + ポート（リポジトリ・時計・監査・冪等キー）。インメモリ実装でテスト
apps/convex            Convex = 業務データの正本。schema、Nogiku SSO（UniQ 由来）、ポートの ctx.db アダプタ、公開関数、cron
apps/api               Hono on Cloudflare Workers = HTTP 境界。R2 へのファイル提出・実体検証・認可付き配信のみ（業務 CRUD は持たない）
apps/web               React 19 + TanStack Router + Material 3 Expressive（@m3e/react）+ PDF.js
docs/                  要件・決定ログ・アーキテクチャ・テスト計画・調査結果・引き継ぎ
```

依存の向きは常に `web / convex / api → application → domain`。Convex の mutation は 1 トランザクションなので、ユースケース内の複数書込み（版の確定と旧版の受付終了など）は原子的に確定する。詳細は [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## ツールチェーン（VoidZero / Vite+）

`vite-plus`（`vp`）を唯一の開発ツールとして採用。Vite 8 / Rolldown / Vitest 5 / Oxlint / Oxfmt / tsdown / Vite Task を同梱。

```bash
# 1. Node 22.18+ と pnpm 10（corepack 可）。vp はグローバルでも、ローカルでもよい
curl -fsSL https://vite.plus | bash        # 任意（無ければ pnpm exec vp）

# 2. 依存インストール
pnpm install

# 3. 静的検査・テスト（全パッケージ）
pnpm check          # vp check: Oxfmt + Oxlint（型対応）
pnpm test           # vp test: domain / application / convex(convex-test) / api / web
pnpm typecheck      # 各パッケージの tsc --noEmit
```

## ローカル起動

初めての場合は手順書 [`docs/HANDS_ON_CONVEX.md`](docs/HANDS_ON_CONVEX.md)（Convex 無料枠＋Nogiku モックで一周）を参照。

### Convex（業務データ）

```bash
cd apps/convex
npx convex dev            # Convex アカウントでログイン → dev deployment 作成（無料枠）。.env.local に CONVEX_DEPLOYMENT と VITE_CONVEX_URL が書かれる
```

Convex ダッシュボード（または `npx convex env set KEY VALUE`）で設定する環境変数:

| 変数                                                          | 用途                                                                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONVEX_SITE_ORIGIN`                                          | Convex Auth の issuer。`https://<deployment>.convex.site`                                                                                                                    |
| `FRONTEND_URL`                                                | ログイン後のリダイレクト先（例 `http://localhost:5173`）                                                                                                                     |
| `NOGIKU_MOCK_ENABLED`                                         | `true` で Nogiku OIDC を呼ばずにモック委員でサインイン（開発・E2E 用）                                                                                                       |
| `NOGIKU_ISSUER` / `NOGIKU_CLIENT_ID` / `NOGIKU_CLIENT_SECRET` | 本物の Nogiku Auth。issuer は `https://<nogiku-auth>/api`。コールバック `https://<deployment>.convex.site/api/auth/callback/nogiku` を Nogiku 側クライアントに登録してもらう |
| `MF100_SYSTEM_ADMIN_SUBJECTS`                                 | 初期の校正システム管理者（Nogiku sub をカンマ区切り）。以後は管理画面で変更                                                                                                  |

Convex Auth は `JWT_PRIVATE_KEY` / `JWKS` も必要とする。初回は `npx @convex-dev/auth` で生成できる（UniQ と同じ手順）。

サンプルデータ（モック時のみ）: `npx convex run seed:demo`

デプロイメント無しでも型チェック・テストは動く: `pnpm codegen`（`apps/convex/scripts/codegen.mjs`）が `convex/_generated` を公式テンプレートと同形式で生成し、コミットしている。`npx convex dev` を実行すると公式生成物で上書きされる。

### Hono API（ファイル）

```bash
cd apps/api
pnpm dev                  # wrangler dev → http://127.0.0.1:8787（R2 はローカルエミュレーション）
```

`wrangler.jsonc` の `vars` に `CONVEX_URL`（`https://xxx.convex.cloud`）と `CONVEX_SITE_URL`（`https://xxx.convex.site`）、`ALLOWED_ORIGINS` を設定。R2 バケットは `mf100-assets`（非公開）。

### Web

```bash
cd apps/web
cp .env.example .env.local    # VITE_CONVEX_URL と VITE_API_URL を設定
pnpm dev                      # http://localhost:5173
```

開発ビルドではサインイン画面に「モック委員でサインイン」が出る（サーバー側 `NOGIKU_MOCK_ENABLED=true` のときだけ成功する）。`seed:demo` の 5 名（管理者・主管・制作者・校正者・校了者）で一周できる。

## 権限・デプロイの概念

- **認証**: Nogiku Auth（OIDC）。独自パスワードは無い。Convex Auth（`@convex-dev/auth`）が JWT を発行し、Convex と Hono の両方で検証する。
- **認可**: 職責（制作者・校了権限者・主管）＋作品単位の個人 ACL（`view / review / edit / manage`）をドメイン層 `isAllowed()` で判定。すべてのサーバー関数が通る。システム管理者は ACL を管理できるが、校了権限は持たない。
- **ファイル**: ブラウザ → Hono → R2（sha256 検証）→ Convex に verified 記録 → 全件 verified で「確定」。配信は毎回認可し、署名付き URL は発行しない。
- **デプロイ**: Convex（Cloud 無料枠 or セルフホスト）、Workers（`wrangler deploy`）、Web は静的配信（Cloudflare Pages 等）。本リポジトリは本番デプロイを行っていない。

## 検証方法

- 受け入れ条件 A-01〜A-20 と自動テストの対応は [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md)。
- 実行していない試験・未実装は [`docs/HANDOVER.md`](docs/HANDOVER.md)。
- v0 → v1 で追加した機能と対象外は [`docs/V1_GAP.md`](docs/V1_GAP.md)。
- Material 3 Expressive の適用方針・前後比較・テーマ検証は [`docs/UI_M3E.md`](docs/UI_M3E.md)。
