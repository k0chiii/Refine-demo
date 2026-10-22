# 任意の基盤機能の設定と受入確認

通常の API/Pages 配信は維持する。新機能は個別に有効化できる。以下のコマンドは準備用で、資源・秘密・ドメインを実際に変更する前に、対象環境と費用を確認する。実データの外部送信・本番配信・移行はこの変更では実行していない。

## Worker の設定

```sh
pnpm platform:config development ai,processing,assets
node scripts/platform-resources.mjs development
cd apps/api
pnpm exec wrangler deploy --config wrangler.platform.generated.json --dry-run --containers-rollout none
```

`platform:config` は元の Wrangler 設定から環境別の設定を生成するだけ。`platform-resources` は Queue、dead-letter Queue、R2 event、未完了 multipart の abort、scratch prefix の期限削除のコマンドを表示するだけ。`--containers-rollout none` の dry-run は Worker の検査に使い、Container イメージのビルド検査とは分ける。

- `ai`: AI binding。リモートモデルの実行は有効化後の明示操作で発生する。
- `processing`: Queue、FileWorkflow、Images、MEDIA、Browser Run、Container。Container は最大 2 台・1 分 idle。Dockerfile の build には Debian パッケージ配布元への接続が必要。
- `assets`: Web の `dist` を Worker Static Assets として配信。事前に本番用 URL で Web をビルドする。API prefix は SPA fallback から外す。既存 Pages の URL は自動変更しない。

staging は専用 Convex/Worker/R2/Queue/Workflow/フロントエンド origin を使い、本番の秘密・データを複製しない。生成された設定を直接配備する場合も、`deploy-api.mjs` と同じ URL/origin の分離を確認する。原本の lifecycle expiration は追加しない。

## 秘密と feature flag

秘密は Wrangler/Convex の環境設定だけに保存し、Git や PR 本文に書かない。

| 設定先           | 名前                                                                                    | 用途                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Worker と Convex | `PROCESSING_SECRET`（32 文字以上）                                                      | ジョブの照会・採用を行うサービス境界                                             |
| Convex           | `PROCESSING_ENABLED=true`                                                               | ジョブ作成の許可                                                                 |
| Convex           | `PROCESSING_CAPABILITIES=image,video-frame,stream,web-snapshot,container-preview,figma` | 実際に接続できた処理だけを列挙。未設定なら UI/作成とも無効                       |
| Convex           | `PROCESSING_ALLOW_RESTRICTED=true`                                                      | 非公開制作物の処理を明示許可する場合だけ                                         |
| Worker           | `FIGMA_ACCESS_TOKEN`                                                                    | Figma の read-only API。利用者の操作で取り込み                                   |
| Worker           | `SNAPSHOT_ALLOWED_HOSTS`                                                                | 収集を許可する公開 HTTPS host の完全一致リスト。自組織で管理する公開 host に限定 |
| Worker           | `STREAM_ACCOUNT_ID`, `STREAM_API_TOKEN`                                                 | 専用 Stream account と必要最小権限の API token                                   |
| Worker と Convex | `WORKERS_AI_SECRET`（32 文字以上）                                                      | Workers AI の private endpoint                                                   |
| Convex           | `AI_PROVIDER=workers-ai`, `WORKERS_AI_URL=https://<worker>/internal/ai/proofread`       | Workers AI provider を選ぶ場合                                                   |
| Convex           | `AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast`                                     | Worker の `WORKERS_AI_MODEL` と一致させる                                        |
| Convex           | `RULE_EMBEDDINGS_ENABLED=true`                                                          | ルール本文の埋め込み送信と意味検索を有効化                                       |

AI Gateway/Access/既存 upload/cleanup の秘密については [PLATFORM_IMPLEMENTATION.md](PLATFORM_IMPLEMENTATION.md) と [RECOVERY.md](RECOVERY.md) を参照。通常の同期 AI は本文・候補を保存しない。Workflow は利用者の一時保存同意が必要で、保存原稿の版を参照し、候補を本人にだけ最大 1 時間表示する。削除 cron は 5 分間隔。外部提供元の保持方針は別途確認する。

処理枠は利用者 20 件/日、作品 40 件/日、利用者の同時未完了 3 件。Workflow は最大 3 回の実行で同じ派生キーを使う。これは金額保証ではない。Stream の予約成功とその記録の間の障害では孤立動画が生じ得るため、Stream 側の job ID metadata も照合する。

## データ移行

`migrations.backfillWorkRoles` は職責・検索 token・一覧要約・Aggregate を同時に修復する。先に隔離環境と dry-run で確認し、バックアップを照合する。旧行は検索・要約の fallback で読み、Aggregate は未移行行があれば ready:false を返す。移行を自動配備に混ぜない。

埋め込みは有効化後に変更されたルールを更新する。既存ルールは `semanticRules.indexRule` を管理用 internal action として必要な ruleId ごとに実行する。対象は有効な現行ルール、モデルは bge-m3/1024 次元。意味検索の結果は現行版・適用カテゴリ・作品 ACL で再照合する。モデル変更時は別索引で作り直す。

共同編集は通常保存の完了後に「共同編集を開始」する。切替後に古いクライアントから通常保存すると拒否する。提出済み版の原本・座標・コメントは書き換えない。デモの DB はタブごとに独立するため、共同編集/Presence/外部処理は本バックエンドで受入確認する。

## 実接続の受入確認

- staging の他人・閲覧者・権限剥奪後の利用者が、処理の作成・途中再開・出力採用をできないこと。派生取得/HLS segment は要求ごとに閲覧 ACL を確認すること。
- multipart の part 再送、完了応答の欠落、全体 SHA 不一致、取消、期限切れを確認し、原本を採用するのが一度だけであること。
- Figma の 429/一時障害、Queue の重複、Workflow 再試行、dead-letter の回収、R2 event の重複を確認すること。R2 event だけで提出物を verified にしないこと。
- Images/動画/Container の派生物と元画像の寸法・時点を照合すること。派生物を原本やコメント座標の基準として自動置換しないこと。
- Browser Run の host allowlist、redirect、subresource、IP/資格情報 URL の拒否を確認すること。認証付きページの取得には使わないこと。
- Stream の署名必須設定と TUS 再開、HLS の manifest/segment の書換えと Authorization、権限剥奪後の次要求の拒否を確認すること。元の R2 Range 配信は維持する。
- Workers AI/Gateway の日本語品質・実利用額・ログ/キャッシュ/保持設定と、Workflow の取消・版変更・候補の期限削除を確認すること。
- Static Assets を試す場合、SPA 深いリンク、`/sw.js` の no-cache と scope、PWA 更新、API のエラーが HTML にならないことを確認してからドメインを切り替えること。

## ツールの更新と package の作成

`pnpm create:package <name> [domain|application]` または root の `vp create` のローカル template を使う。既存ディレクトリは上書きしない。`pnpm package:domain` は独立した manifest と JS/型宣言を作るが公開しない。

ツール更新時は隔離 branch で `pnpm toolchain:migrate` を実行し、package.json・lockfile・pnpm-workspace.yaml・設定の diff を確認する。Vite+、同梱 Vitest、override、coverage provider、setup-vp の固定値を同時に照合し、`pnpm toolchain:check`、check/test/typecheck、E2E/PWA を実行する。
