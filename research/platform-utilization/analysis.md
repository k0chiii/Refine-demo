# Vite+・Convex・Cloudflare 活用候補と現状との対応

調査日: 2026-10-22。対象は MF100 Refine の現在のチェックアウト。依頼にある分析・リストアップとして、原文の抜き書きとは別に評価を書く。評価と優先度はこのコードからの推論であり、ベンダーの推奨順位ではない。

**追加活用の中心は Vite Task のキャッシュと依存関係、Convex の読み取り範囲と外部処理の信頼性、Cloudflare の環境分離・型生成・追跡である。** 画像・動画・共同編集にも候補があるが、現在の原本保存・認可・外部送信の条件を変えるものは後続に置く。

## 調査範囲と読み方

- 3製品の機能群を、現在のコードの用途に対応づけた。候補は Vite+ 10件、Convex 14件、Cloudflare 18件。さらに7件の採用境界を記載した。
- 「すべて」は現在のアプリに適用できる機能群を広く検討する意味で扱った。Cloudflare の全製品・全 API の網羅を保証する一覧ではない。
- **P1**: 現在の実装に対応する改善候補。設定の照合や対象の計測から始める。
- **P2**: 効果・規模・運用条件が確認できたら進める候補。
- **P3**: 新しい要件、方針変更、費用対効果の検討が必要な候補。
- 「合格条件」は将来実装する際の確認項目。今回、アプリのテスト・負荷試験・デプロイは行っていない。
- クラウド管理画面、契約プラン、請求、実データ件数、実環境ログは未確認。「コードに設定が無い」と「クラウドで未使用」は区別した。

現状のコード参照は [current-evidence.md](current-evidence.md)、公式原文一覧は [map.md](map.md)、機械照合した抜き書きは [report.html](report.html)、取得履歴は [log.md](log.md) を参照。

## すでに使われているもの

| 基盤 | 確認できた利用 | 追加導入として数えないもの |
|---|---|---|
| Vite+ | 1.2.0。`vp check`、型対応 lint、整形、複数プロジェクトの Vitest、Web のビルドと開発サーバー、`vp run -r`、`defaultPackage`。domain には `vp pack` の設定もある | Vite+ 自体の移行、lint・fmt の統合、domain の pack の新設 |
| Convex | schema・複合索引・タイトル検索索引、認証、リアルタイム購読、mutation の原子的更新、cron、scheduler、未読通知の索引、バッチ継続、一部のページネーション、冪等キー、監査、下書きの版衝突検出 | 「索引を初めて使う」「通知を初めて非同期化する」「移行を初めて分割する」という提案 |
| Cloudflare | Hono Workers、非公開 R2、ストリーミング提出と配信、SHA-256 検証、gzip の可逆圧縮、Range・ETag、JWKS 再利用、同時認可問い合わせの集約、孤立ファイル清掃 cron、observability、Pages のデモ PR プレビュー、静的資産のヘッダー | Range 対応の新設、公開 R2 化、PWA 更新の差分再利用の新設、observability の単純な有効化 |

根拠: [ルート設定](../../vite.config.ts)、[domain の pack](../../packages/domain/vite.config.ts)、[Convex schema](../../apps/convex/convex/schema.ts)、[R2 adapter](../../apps/api/src/adapters/r2Store.ts)、[Workers entry](../../apps/api/src/index.ts)、[既存の費用改善](../../docs/COST.md)。

## Vite+：10件

現行の公式設定と、インストール済み 1.2.0 の `Task` / `TaskCacheConfig` 型を照合した。`run.tasks`、`dependsOn`、`cache.env/input/output` はローカルの型にもある。最新ドキュメントの例を採用するときは、同梱ツールの版も確認する。

| ID・優先度 | 適用箇所と現状 | 活用案 | 条件・合格条件 | 原典 |
|---|---|---|---|---|
| V01・P1 | ルート `package.json` と各パッケージ。`vp run` は使うが `run.tasks` / cache 設定は無い | build・typecheck・codegen のうち決定的な処理をキャッシュ可能なタスクにする。公式では package.json scripts は既定でキャッシュされない | `VITE_CONVEX_URL`・`VITE_API_URL`・mode・共有ソース・ロックファイルを適切に追跡。deploy・外部状態を変える処理は `cache:false`。同条件でヒットし、接続先変更で失効すること | [Task caching](https://viteplus.dev/guide/cache) |
| V02・P1 | CI はルート型の生成のため Web build を静的検査より先に実行する | `dependsOn` で生成物 → 型・lint → 必要なビルドの関係を明示する。生成を独立させられるか調べる | `routeTree.gen.ts` と Convex `_generated` の生成・復元漏れを防ぐ。タスク名と既存 script 名の衝突も避ける。クリーンなチェックアウトで順序が成立すること | [Run](https://viteplus.dev/guide/run) |
| V03・P2 | CI の shard・visual・CD がデモ版を各自ビルドする | 同一コミットの成果物共有、または Vite Task のキャッシュ再利用を比較する | `docs/CI_CD.md` の既存計測ではデモ build は約5秒。転送のほうが遅い可能性がある。GitHub Actions 跨ぎのタスクキャッシュは公式で experimental。まず1ジョブ内で評価 | [CI cache](https://viteplus.dev/guide/github-actions-cache) |
| V04・P1 | `vp check` は `typeAware` と `typeCheck` が有効。その後全パッケージの `tsc` も走る | 検査対象の重なりを洗い出し、同じ検査の重複を減らす | web の `tsconfig.e2e.json`、Convex、型生成が漏れないことが前提。`vp check` と `tsc` の完全互換は未確認なので、一括削除は判断できない | [Check](https://viteplus.dev/guide/check) |
| V05・P2 | ローカルに `.node-version`、CI は `node-version:22`、pnpm は別 Action でセットアップ | `setup-vp` と `vp env` による実行環境の統一を検討する | `.node-version` は調査開始時から利用者の変更がある。今回編集していない。導入時は Node・pnpm・Vite+ の版を一致させ、既存 overrides と許可したビルドスクリプトも維持 | [CI](https://viteplus.dev/guide/ci)、[Env](https://viteplus.dev/guide/env) |
| V06・P2 | staged 検査の設定は確認できない | `vp staged` を使い、変更したファイルをコミット前に検査する | 全体 CI の代替にしない。自動修正を入れるなら、ステージ外の利用者の変更を取り込まない運用にする。生成物・外部文書は対象外にする | [Commit hooks](https://viteplus.dev/guide/commit-hooks) |
| V07・P2 | API は `wrangler dev`、API の Vite 設定はテストのみ | Cloudflare Vite plugin で API の開発・ビルド・preview を Vite に統合する候補 | 現状の `wrangler dev` も workerd を使う。追加価値は主に開発経路の統合。Vite+ 1.2.0・Vite override・plugin の互換性は未検証。R2 と cron の確認経路を維持 | [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) |
| V08・P2 | Vitest は全5プロジェクトを束ねる。Playwright は別の明示的な仕組み | ローカルで project / 対象テストを選び、必要な場所だけ coverage を評価する | CI の既存 E2E・PWA・実行環境固有の確認は維持。外部環境依存テストを安易にキャッシュしない。速さは実測で判断 | [Test](https://viteplus.dev/guide/test) |
| V09・P3 | domain は既に pack 設定があり、workspace は TypeScript ソースを export する | 外部配布や独立 CLI が必要になったとき、`vp pack` の型宣言・配布形式を利用する | 現状のソース参照にビルド依存を足す価値は未確認。アプリ内利用だけなら新しい配布工程を増やす根拠が弱い | [Pack](https://viteplus.dev/guide/pack) |
| V10・P3 | 新規 package の雛形と更新は個別設定 | `create` の既定と `vp migrate` を使い、今後の package 追加・ツール更新を揃える | 既存設定を読むだけの調査では migrate は実行しない。更新時は diff を確認し、Vite/Vitest overrides と同梱版をまとめて扱う | [Config](https://viteplus.dev/config/)、[Migration rules](https://viteplus.dev/guide/migrate-rules) |

## Convex：14件

| ID・優先度 | 適用箇所と現状 | 活用案 | 条件・合格条件 | 原典 |
|---|---|---|---|---|
| C01・P1 | `home.submitTargets` と `documents.writable` は `listMyWorks` を起点にする。`workRoles` 派生表と索引は既存 | 職責・担当・権限から候補を狭めてから、domain の認可を適用する | これは `docs/COST.md` でも保留された案。`workRoles` の既存データ同期を先に確認する。担当チーム・有効 ACL・管理者など、職責以外の許可も候補集合から落とさない | [Indexes](https://docs.convex.dev/database/reading-data/indexes/) |
| C02・P1 | `works.listMine` は制作物を読んだ後で年・状態・文字を絞る。`listMyWorks` は機密区分ごと最大2,000件 | 年度・状態等の複合索引、明示的なページネーション、対応する `usePaginatedQuery` を検討する | 今の想定は年度数百件。2,000件超の欠落は将来の規模リスク。ACL で除外して空ページになっても継続できる cursor、並び、総件数、検索との整合を設計する | [Pagination](https://docs.convex.dev/database/pagination)、[Indexes](https://docs.convex.dev/database/reading-data/indexes/) |
| C03・P2 | `search_title` は定義済みだが一覧は title・legacyId・category・purpose・tags の `includes` | 検索専用のフィールドや索引を設計して、検索時の読み取りを減らす | 公式検索は空白・句読点による token 化で Latin-script 向き。日本語の部分一致、複数項目、結果順をそのまま代替できない。索引を使うだけの置換は不可。現行検索との差を具体例で評価 | [Full text search](https://docs.convex.dev/search/text-search) |
| C04・P2 | `works.listMine/get`、`dashboard.get` が版・指摘・専門確認を読む | 一覧向けの要約行と Aggregate を、計測上重い集計に限定して検討する | 全書込み・状態遷移と同じ mutation で派生値を更新し、既存分を埋める。権限範囲の違う利用者に総数を漏らさない。上限100件の未読バッジ等は既存の索引で十分な可能性 | [Aggregate](https://github.com/get-convex/aggregate)、[Best practices](https://docs.convex.dev/understanding/best-practices) |
| C05・P2 | 一覧・詳細が広い文書群を購読する。一部の軽量 query 分離は既に実施済み | 一覧の要約と本文・履歴・高頻度更新を分離し、購読の再実行範囲を減らす | 更新ごとの再実行数と DB 帯域を確認し、重い query に絞る。購読を維持するだけのキャッシュは隠れた継続コストも評価。権限変化時の反映を保つ | [Best practices](https://docs.convex.dev/understanding/best-practices) |
| C06・P1 | AI action は権限・機密区分・文字数を確認するが、利用頻度・利用額の業務的な上限は見当たらない | Rate Limiter を利用者・作品・処理種別単位に入れる候補 | 文字数制限と頻度制限を分ける。厳密な予算は予約・消費・失敗時の扱いまで設計する。Workers 側の制限だけでは Convex action の直接呼出しを防げない | [Rate limiter](https://github.com/get-convex/rate-limiter) |
| C07・P1 | Web Push は mutation で予約済み。`pushNode.deliver` は端末へ順番に送る | Workpool で並列数・再試行・完了処理を管理する。外部 API の負荷を用途ごとに分ける | 通常の scheduled action は失敗時に自動再試行されない。送信直後の障害は重複を生むので、通知ID・購読IDの配送記録と製品側の重複表示抑制を設計。送信直前の認可を維持 | [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)、[Workpool](https://github.com/get-convex/workpool) |
| C08・P2 | FB 移行は既に batch・再開・冪等性を実装している | 今後の索引変更・派生表整備・年度変更に Migrations を使い、進捗と再開を揃える | 進行中・承認待ちの既存移行を機械的に置換しない。バックアップと dry-run、読み書きの互換性を先に定める。Component の導入だけで業務変換は不要にならない | [Migrations](https://github.com/get-convex/migrations) |
| C09・P2 | pin・既読・リアクションは通常の mutation。公式の optimistic API 呼出しは検索範囲で見当たらない | 小さく戻せる操作に `withOptimisticUpdate` を適用する候補 | 校了・提出確定はサーバー確定を待つ。デモの `useMutation` は bare function で、`.withOptimisticUpdate` に未対応。デモとの API 対応も同時に必要 | [Optimistic updates](https://docs.convex.dev/client/react/optimistic-updates) |
| C10・P3 | 閲覧者・入力中の共有機能は見当たらない | Presence で同じ作品を開いている人や編集の競合兆候を表示する候補 | room への参加を作品 ACL で認可。複数タブ・退出・timeout を扱う。表示すること自体が利用者情報の共有になるため用途を決める | [Presence](https://github.com/get-convex/presence) |
| C11・P3 | Tiptap 下書きは `baseVersion` による衝突拒否。共同編集は後続と明記 | ProseMirror Sync で共同編集と snapshot を実装する候補 | live draft と提出済みの不変の版を分ける。既存の座標・コメント・形式変更・認可を維持する。現在の版衝突処理を失敗と見なして削除しない | [ProseMirror sync](https://github.com/get-convex/prosemirror-sync) |
| C12・P3 | 任意 AI 校正は同期 action で候補を返し、本文と結果を保存しない | 長い処理が必要になったら Workflow、表記ルールの意味検索が必要なら vector search を検討する | Workflow は状態と step の入出力を永続化するため「保存しない」方針と要調整。埋め込み・外部送信も事前に定義し、ルールの版と作品 ACL を取得後に再確認する | [Workflow](https://github.com/get-convex/workflow)、[Vector search](https://docs.convex.dev/search/vector-search) |
| C13・P1 | 復旧用バックアップがクラウドで設定されているかは未確認 | Convex Backup & Restore を中心に、R2 の原本と照合できる復旧手順を作る候補 | Convex のバックアップに R2 は含まれない。code・env・scheduled functions も含まれない。定期バックアップはプラン条件あり。復元は破壊的なので、隔離先で先に確認する | [Backup & Restore](https://docs.convex.dev/database/backup-restore) |
| C14・P2 | PR はブラウザ内の convex-test デモ。実バックエンドの PR 環境はワークフローに無い | Convex preview deployment と Workers・R2 の専用環境を組み、実接続の確認経路を設ける候補 | 一時 deployment は beta・期限付き。本番データを複製しない。Nogiku の redirect、各 URL・秘密・CORS を環境単位に揃え、必要なら固定 staging を使う | [Multiple deployments](https://docs.convex.dev/production/multiple-deployments) |

## Cloudflare：18件

| ID・優先度 | 適用箇所と現状 | 活用案 | 条件・合格条件 | 原典 |
|---|---|---|---|---|
| F01・P1 | `wrangler.jsonc` の既定と production は同じ Worker 名・バケット名。API の `deploy` script は環境を指定しない | development・staging・production の設定と資源を明示的に分ける候補 | 現在のローカル R2 はエミュレーションであり、本番に接続しているという指摘ではない。一方、環境なしの deploy の行き先は見直す余地がある。vars・bindings・secrets の環境ごとの設定を照合する | [Environments](https://developers.cloudflare.com/workers/wrangler/environments/) |
| F02・P1 | `Bindings` は手書き、runtime 型は `workers-types` v5 | `wrangler types` による binding・compatibility date/flags 対応の型生成を導入する候補 | 生成型とアプリ所有の port/interface を分ける。バケット名や環境変数の追加漏れを静的に見つける。生成はまだ実行していない | [TypeScript](https://developers.cloudflare.com/workers/languages/typescript/) |
| F03・P1 | observability は有効。アプリ全体の相関ID・tracing 設定はコードで明示されていない | Workers Logs / Traces / Metrics を使い、Worker → Convex → R2 → 外部API を追う | route・処理ID・objectKey の扱い・時間・再試行回数を定義し、JWT・本文・秘密はログに出さない。401/403・429・R2失敗・清掃滞留を区別。権限のある管理画面で sampling と保持期間を確認する | [Observability](https://developers.cloudflare.com/workers/observability/) |
| F04・P2 | ファイルと Figma の HTTP 境界に専用の rate binding は無い | Workers Rate Limiting binding で、過剰な要求を早い段階で抑える候補 | 制限は Cloudflare 拠点ごとで近似的。厳密な日次費用上限には使わない。同じ学内回線の利用者を IP だけでまとめない。C06 の業務上限と役割を分ける | [Rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |
| F05・P2 | 現在は単一 PUT。転送上限100MB、対象原本は gzip 後上限と元サイズ上限を別管理 | R2 multipart で、失敗した part の再送と再開を実装する候補 | Worker 経由の各リクエストは Cloudflare の body 上限を受ける。最終確定・総サイズ・全体 SHA・試行IDを再検証し、multipart ETag を全体SHAの代わりにしない。上限変更は別の要件判断 | [Upload objects](https://developers.cloudflare.com/r2/objects/upload-objects/)、[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| F06・P2 | Figma はHTTP要求内で最大50項目を扱い、429 は1回再試行する | Queues で転送ジョブを受け、R2 event notifications は後処理の起点にする候補 | R2 への作成イベントは業務上の verified を意味しない。Convex で採用済みか照合する。重複配送に備えた job ID、失敗キュー、再処理手順が必要。期限後も生JWTをジョブへ持ち回らない | [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)、[R2 events](https://developers.cloudflare.com/r2/buckets/event-notifications/) |
| F07・P3 | ファイル転送・外部 API の複数段階は個別の手続き | Cloudflare Workflows で Figma 待機・転送・検証・確定・失敗回収を段階化する候補 | ファイル側の責務に限定する。Convex Workflow と同一の業務状態を二重管理しない。再開時は現在の受付状態と認可を再判定し、外部API呼出しの冪等性を確保 | [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) |
| F08・P2 | 業務孤立オブジェクトは Convex 判定と Worker cron で清掃済み | multipart 導入時の未完了 part 中止や、再生成できる一時ファイルに lifecycle を使う候補 | 保存済み原本・監査対象は経過日数だけで削除しない。prefix を分け、業務の保持条件を満たす。現状の単一PUT清掃を単に lifecycle へ置換する案ではない | [Object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) |
| F09・P3 | 画像処理はクライアント中心。劣化ゼロの方針がある | Images binding の `.info()` で寸法等を確認し、変換は合意した派生表示物だけに使う候補 | private R2 の bytes を渡せる。binding 入力上限は20MBで、現在の提出上限と違う。原本を再エンコードしない。縮小・WebP化を「劣化ゼロの最適化」と呼ばない。PNGでも色・画素・metadataの同一性は別途確認 | [Images binding](https://developers.cloudflare.com/images/optimization/binding/)、[Limits](https://developers.cloudflare.com/images/get-started/limits/) |
| F10・P3 | 動画は原本と時刻指定コメントを扱う。サーバーの派生フレーム生成は未確認 | Media Transformations で指定時刻の静止画や spritesheet を作る候補 | 元動画・タイムコード・コメント座標との対応を保持する。binding は public beta、ローカル simulation 非対応。開発でも remote の資源・費用条件を確認する | [Media binding](https://developers.cloudflare.com/stream/transform-videos/bindings/) |
| F11・P3 | 現状の動画は R2 の認可つき Range 配信 | Stream を配信用派生物に利用する候補 | 再エンコードした配信用動画は原本として扱わない。署名URLは有効期限内に権限剥奪を即時反映できるとは限らない。既存の「次の要求で拒否」と整合する配信設計が必要 | [Secure Stream](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/) |
| F12・P3 | Web 校正用の素材・外部URLを扱う機能がある | Browser Run（旧 Browser Rendering）でサイズを固定したページ画像・snapshot を作る候補 | 対象URL、内部宛先、redirect、cookie、認証、動的ページの再現条件を制御する。公開済みページから検討し、出力を提出済み版に結びつける。ログイン済みページを無断収集しない | [Browser Rendering](https://developers.cloudflare.com/browser-rendering/) |
| F13・P3 | OCR・PDF・画像比較は主にブラウザ。Worker は転送境界 | Containers を、専用バイナリが必要な重い変換の実行先として検討する | CPU・メモリ・入力サイズ・実行時間・起動時間・費用を見積もる。現状の端末内処理を移すと外部保存・通信条件が変わる。Worker のみで任意の重い処理が実行できると仮定しない | [Containers](https://developers.cloudflare.com/containers/)、[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| F14・P2 | Anthropic provider を Convex から直接呼ぶ | AI Gateway の利用量・障害観測・制限を provider adapter に組み込む候補 | 本文ログ・キャッシュ・fallback による追加送信先を先に決める。現状の本文非保存・任意送信と整合が必要。自動 fallback は校正品質とデータ取扱いの条件を変える | [AI Gateway](https://developers.cloudflare.com/ai-gateway/) |
| F15・P3 | 既存の AI provider port がある | Workers AI を追加 provider、将来の画像・音声補助の候補として比較する | 日本語校正精度、遅延、入力形式、モデルごとの利用条件・費用を評価する。既存 model と同品質・低価格とは未確認。機密区分・明示操作のルールを共通適用 | [Workers AI](https://developers.cloudflare.com/workers-ai/) |
| F16・P3 | Web は Pages、ファイル API は別 Worker | Workers Static Assets と Vite plugin で配信先をまとめる候補 | SPA fallback、`/api` と静的資産の route、PWA、CORS、キャッシュヘッダーの互換性を確認する。既存 Pages が動くなら移行だけの効果は小さい可能性。SSR は別の要件 | [Static Assets](https://developers.cloudflare.com/workers/static-assets/) |
| F17・P2 | 認証と作品 ACL は Nogiku / Convex。PR デモはバックエンドなし | Cloudflare Access を、必要なプレビュー・管理用HTTP入口の追加防御に使う候補 | アプリの認証・作品 ACL は引き続きサーバーで判定する。PWA・API・WebSocket・自動処理との組み合わせを確認。公開用デモへ不要なログイン段階を増やさない | [Access HTTP applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/) |
| F18・P1 | 本番 CD は Convex → Worker → Pages の順。跨る配信単位の戻し手順は未確認 | Workers Versions / Rollbacks と成果物IDを使い、障害時の対応版を記録する候補 | Worker の rollback は Convex schema・R2実体・Pages を一括で戻さない。古いWebと新APIの互換期間、データ変更を戻せない場合の前進修正、binding変更による制限を定める | [Rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) |

## 採用の境界：7件

| ID | 機能 | 現状での扱いと理由 |
|---|---|---|
| X01 | D1 | [SQL DB](https://developers.cloudflare.com/d1/) が必要な独立用途が現れたときの候補。works・ACL・校了の正本を追加すると整合と認可が二重になる。現在の業務 CRUD の移植は推奨しない |
| X02 | Workers KV | [KV は結果整合](https://developers.cloudflare.com/kv/concepts/how-kv-works/)。公開で変更頻度の低い設定には候補だが、権限剥奪・校了判定・厳密な残予算の正本には適さない |
| X03 | Durable Objects | [接続の協調や状態管理](https://developers.cloudflare.com/durable-objects/) が Convex で満たせない用途の候補。Presence・共同編集を採用する場合は、同じ room 状態を両方に持たせる理由を先に決める |
| X04 | Vectorize | [ベクトルDB](https://developers.cloudflare.com/vectorize/) の独立用途がある場合に比較する。現状の作品・ルールの検索は Convex にデータと認可があり、まず C12 と比較する。二重索引を作るなら削除・権限変更・版同期が必要 |
| X05 | Cache API / CDN | [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) は静的な公開資産で利用を検討する。非公開原本は既存の no-store 方針を守る。現在のサムネイルは private cache の例外があり、それを全ファイルへ広げる根拠にはならない |
| X06 | Turnstile | 現在は SSO で閉じた用途。公開フォームや自動アクセスの実害が出たら候補にする。今回 `fetch.py` は公式本文中の captcha という語を壁と判定し、原文保存に失敗したため、具体的な導入仕様は評価していない |
| X07 | その他の専用基盤 | SQL 接続前提の Hyperdrive、配信メール、課金、外部検索基盤等は、対応する現在の要件を確認できない。採用判断の対象外。Cloudflare 全製品を使うために新しい業務要件を足すことはしない |

## 推奨する進め方

1. **接続先と運用の基準を揃える**: F01・F02・F03。設定と生成型を照合し、どの要求でどこに時間と失敗が出るか分かるようにする。C13・F18 の復旧範囲も確認する。
2. **開発の重複を減らす**: V01・V02・V04。生成物の依存関係と環境変数を含むキャッシュを整える。CI 跨ぎのキャッシュは最後に費用対効果を測る。
3. **読み取りと外部処理を絞る**: C01・C02・C06・C07。職責データの同期、実データ規模、通知失敗時の挙動を確認したうえで進める。
4. **用途が決まった機能を追加する**: 大きな提出が多ければ F05、Figma のタイムアウトが多ければ F06/F07、共同執筆が必要なら C10/C11。判断材料の無い機能は後続に置く。

## 責務の置き方

| 対象 | 推奨する正本・実行場所 | 境界 |
|---|---|---|
| 作品・版・コメント・校了・ACL・監査 | Convex + domain/application | 原子的に変わる業務状態をまとめる |
| 生ファイル・不変の原本 | private R2 | hash・採用状態は Convex と対応づける |
| ファイル転送・認可つき配信・外部ファイル取得 | Workers | 業務上の採否は Convex へ問い合わせる |
| 通知配送と業務起点のジョブ | まず Convex scheduler / Workpool | DBの更新と予約を同じ mutation に置く |
| 長いファイル処理 | 要件に応じて Cloudflare Queues / Workflows | 処理IDで Convex に結果を返す。同じ状態機械を二重管理しない |
| 共同編集 | 必要になれば Convex の専用 component | 下書きと提出済み snapshot を分離する |
| ツール・タスク・キャッシュ | Vite+ | 外部の実データ状態を build cache に混ぜない |

## 実装時に測るもの

| 改善 | 測定・確認の対象 |
|---|---|
| V01〜V04 | cold/warm の所要時間、cache hit、誤った復元、環境変更時の失効、CI全体の壁時計 |
| C01〜C05 | query ごとの DB 読取り量・再実行回数、候補件数、一覧の欠落、ACL差分 |
| C06〜C07 | 同時要求・失敗時の消費、429、配送の重複、未配送、待ち時間、利用上限 |
| F03〜F08 | Worker の CPU/メモリ/遅延、転送失敗率・再送バイト、Queue 滞留、孤立ファイルの残留 |
| F09〜F15 | 原本hash、画像の画素と色、動画時刻、出力品質、処理時間、外部送信・保存の範囲 |
| C13・C14・F01・F18 | 隔離環境の接続先、古いクライアントとの互換性、復旧時間、復旧可能な時点 |

今回は文書とコードの読取りによる分析である。短縮率、料金削減額、実データでの欠落・配送障害の発生は断定していない。`docs/COST.md` と `docs/CI_CD.md` の数字は既存の記録であり、今回の計測結果ではない。
