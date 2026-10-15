# ハンズオン: Convex Cloud（無料枠）でローカル開発を一周する

所要 30 分程度。Nogiku は **モック**で動かす（本物の Nogiku 連携は後日）。手順どおりに進めれば、ブラウザで「制作物登録 → 版提出 → 指摘 → 校了」まで試せる。

> 用語: **deployment** = Convex 上の 1 つのバックエンド環境。各開発者に 1 つの dev deployment が無料で付く（Starter プラン: 無料、クレジットカード不要）。

## 0. 前提

- Node.js 22.18 以上、pnpm 10（`corepack enable` で使える）
- このリポジトリを clone 済み: `git clone https://github.com/k0chiii/Refine-demo && cd Refine-demo && git switch claude/sweet-rubin-ere7s0`
- `pnpm install` 済み

## 1. Convex アカウントと dev deployment を作る

```bash
cd apps/convex
npx convex dev
```

1. ブラウザが開き、GitHub でログインするよう促される（Convex のアカウント作成）。
2. ターミナルに戻ると「Create a new project?」→ **Enter**（プロジェクト名は `mf100-refine` など）。
3. 「dev deployment を cloud に作るか local か」を聞かれたら **cloud** を選ぶ。
4. 成功すると `apps/convex/.env.local` に次が書かれる（コミットしない。.gitignore 済み）:
   ```
   CONVEX_DEPLOYMENT=dev:xxxx-yyyy-123
   VITE_CONVEX_URL=https://xxxx-yyyy-123.convex.cloud
   ```
5. `npx convex dev` は **起こしたまま**にする（ファイル変更を自動で deployment に反映し、`convex/_generated` を公式生成物で上書きする）。以降は別のターミナルで作業する。

ダッシュボードは https://dashboard.convex.dev 。左メニュー **Settings → Environment Variables** で次の手順の変数を設定する。

## 2. Convex Auth の鍵と環境変数を設定する

Convex Auth（UniQ と同じ）は JWT を発行するための鍵が必要。新しいターミナルで:

```bash
cd apps/convex
npx @convex-dev/auth
```

- 「Configure SITE_URL?」→ `http://localhost:5173`（Web の URL）
- 鍵（`JWT_PRIVATE_KEY`, `JWKS`）と `SITE_URL` が deployment の環境変数に自動設定される。

次に、残りの変数を設定する（ダッシュボードでも、CLI でもよい。値の `https://xxxx-yyyy-123.convex.site` は `.env.local` の `VITE_CONVEX_URL` の `.cloud` を `.site` に変えたもの）:

```bash
npx convex env set CONVEX_SITE_ORIGIN https://xxxx-yyyy-123.convex.site
npx convex env set FRONTEND_URL http://localhost:5173
npx convex env set NOGIKU_MOCK_ENABLED true
npx convex env set MF100_SYSTEM_ADMIN_SUBJECTS mock-nogiku-admin
npx convex env set MF100_UPLOAD_SECRET "$(openssl rand -hex 24)"    # ファイル提出の共有秘密（必須。Hono 側にも同じ値を設定）
npx convex env set MF100_CLEANUP_SECRET "$(openssl rand -hex 24)"   # R2 清掃用の共有秘密（任意。Hono 側にも同じ値を設定）
npx convex env list   # 確認
```

| 変数                          | 意味                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `CONVEX_SITE_ORIGIN`          | Convex Auth の issuer。`auth.config.ts` が参照                                                         |
| `FRONTEND_URL`                | ログイン後に戻る Web の URL                                                                            |
| `NOGIKU_MOCK_ENABLED`         | `true`: Nogiku OIDC を呼ばず、モック委員でサインイン                                                   |
| `MF100_SYSTEM_ADMIN_SUBJECTS` | 校正システム管理者にする Nogiku sub（モックは `mock-nogiku-admin`）                                    |
| `MF100_UPLOAD_SECRET`         | Hono だけが実体の検証完了を記録できる共有秘密（16 文字以上）。未設定ならファイルを提出できない         |
| `MF100_CLEANUP_SECRET`        | Hono の R2 清掃 cron が `/internal/upload-orphans` を呼ぶ共有秘密（16 文字以上）。未設定なら清掃は無効 |

> 本物の Nogiku に切り替えるときは `NOGIKU_MOCK_ENABLED` を外し、`NOGIKU_ISSUER` / `NOGIKU_CLIENT_ID` / `NOGIKU_CLIENT_SECRET` を設定する（HANDOVER 参照）。

## 3. サンプルデータを入れる

```bash
cd apps/convex
npx convex run seed:demo
```

モック委員 5 名（管理者・主管・制作者・校正者・校了者）と制作物 3 件が入る。ダッシュボードの **Data** タブで `users` / `works` を確認できる。

## 4. Hono API（ファイル保存）を起動する

```bash
cd apps/api
# wrangler.jsonc の vars を自分の deployment に合わせる（または .dev.vars を作る）
cat > .dev.vars <<EOF
CONVEX_URL=https://xxxx-yyyy-123.convex.cloud
CONVEX_SITE_URL=https://xxxx-yyyy-123.convex.site
ALLOWED_ORIGINS=http://localhost:5173
MF100_UPLOAD_SECRET=<Convex に設定した値と同じ>
MF100_CLEANUP_SECRET=<Convex に設定した値と同じ>
EOF
pnpm dev     # http://127.0.0.1:8787 。R2 はローカルにエミュレーションされる（Cloudflare アカウント不要）
# 清掃 cron を手で動かす: pnpm exec wrangler dev --test-scheduled → curl http://127.0.0.1:8787/__scheduled
```

初回は `wrangler` が Cloudflare ログインを求めることがあるが、`wrangler dev` のローカル実行だけなら **ログイン不要**（求められたら Esc で抜けてよい）。

## 5. Web を起動する

```bash
cd apps/web
cat > .env.local <<EOF
VITE_CONVEX_URL=https://xxxx-yyyy-123.convex.cloud
VITE_API_URL=http://127.0.0.1:8787
EOF
pnpm dev     # http://localhost:5173
```

## 6. 一周してみる

1. http://localhost:5173 → サインイン画面の「開発用: モック委員でサインイン」を開き、**五月 めい（制作者）** を選んでサインイン。
2. 「制作物」→ `MF100 公式パンフレット` → **版を提出** → PDF を選び「アップロードを開始」→ 全ファイル「検証済み」になったら **提出を確定する**。
3. サインアウトして **本郷 校正（校正者）** でサインイン → 「校正待ち」には何も無い（割当前）。
4. **五月 主管** でサインイン → 制作物詳細 → 版の行の「校正者を割当」で **本郷 校正** を検索して選ぶ（候補は一度でもサインインした委員）。
5. **本郷 校正** でサインイン → 「校正待ち」→ 版を開く → PDF 上でドラッグして範囲を選び、重大度 `重大` で指摘を投稿。
6. **駒場 校了** でサインイン → 制作物詳細 → **校了を宣言** → 重大未解決があるため拒否されることを確認 → 例外理由を入れると例外校了できる（または制作者が不採用理由を記録してから通常校了）。
7. ダッシュボードの **Data → auditEvents** に全操作が残っていることを確認。
8. （v1）版提出時に「専門確認」を宣言すると、担当者が「確認完了」するまで理由なしの校了は拒否される。第 2 版を提出すると前版の未解決指摘を「この版へ引き継ぐ」できる。左ナビ「通知」に自分宛の通知が届く。

## 7. よくあるつまずき

| 症状                            | 原因と対処                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| サインインで「unauthenticated」 | `CONVEX_SITE_ORIGIN` が `.site` ドメインになっていない / `npx @convex-dev/auth` を実行していない                                                 |
| モックでサインインできない      | `NOGIKU_MOCK_ENABLED` が `true` でない。`npx convex env list` で確認                                                                             |
| アップロードが 401              | API の `CONVEX_SITE_URL` が Web の deployment と一致していない                                                                                   |
| アップロードが CORS エラー      | API の `ALLOWED_ORIGINS` に `http://localhost:5173` が無い                                                                                       |
| 「管理」メニューが出ない        | `MF100_SYSTEM_ADMIN_SUBJECTS` に `mock-nogiku-admin` が無い状態で一度ログインした → ダッシュボードの `users` で `isSystemAdmin` を `true` に直す |
| `convex dev` が型エラーで止まる | `pnpm typecheck` で該当箇所を直す。`_generated` は `convex dev` が再生成する                                                                     |

## 8. 無料枠の目安（2026-10 時点の Starter）

個人の dev deployment と小規模な本番 deployment が対象。関数実行回数・データベース容量・ファイル容量に月次上限があり、超えると**停止ではなく警告**（有料プランへの移行を促される）。MF100 の試験運用規模なら無料枠で収まる見込みだが、繁忙期の実測で判断する（要件 §8 Convex 運用 / D11）。R2 は Cloudflare の無料枠（10GB）を想定。
