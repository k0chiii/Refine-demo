# 調査ログ

## 0周目

- 依頼: 現状に照らし Vite+・Convex・Cloudflare を最大限活用できる箇所を分析・リストアップ。追加指定: imozuru を使う。
- 検索役: 起動なし。ユーザー指定 gpt-5.6-terra は利用可能モデルに無いため、スキルの代替手順で親が順に検索する。別モデルへの置換はしない。子プロセスの検索 CLI は親が管理する。
- 探し方1: 英語で公式機能・制約・APIを検索。Vite+ の cache/run/CI、Cloudflare の Vite plugin が候補として出た。
- 探し方2: 日本語で製品名と業務の用語を検索する。下に結果を追記する。
- Context7 resolver: Vite+ `/voidzero-dev/vite-plus`、Convex `/llmstxt/convex_dev_llms-full_txt`、Cloudflare Workers `/llmstxt/developers_cloudflare_workers_llms-full_txt` を公式対応先として選択。
- ローカル読取り: package.json、各 vite.config.ts、wrangler.jsonc、CI/CD、Convex schema・一覧・AI・cron・R2 adapter。実行前から .node-version に利用者の変更あり。変更しない。
- 保存先: 書込み可能な research/platform-utilization/。アプリの変更・本番操作は依頼範囲にない。

## 0周目の結果補足

- 日本語検索では、同名の別分野（金融の Convex・企業名）や非公式翻訳が混在した。採用した場は Vite+ Guide/Config、Convex Docs/公式 get-convex、Cloudflare Developers/公式 GitHub。発見には日本語と英語、Context7 resolver の3経路を用いた。
- 技術仕様の問いなので、根拠は公式ガイド・APIリファレンス・開発者本人の README に限定した。論文は今回の製品仕様の正本ではなく、対象外。

## 1周目：原文保存と追跡

- 英語のガイド → 設定/API/制約のリンクを後ろへたどった。Convex Components → 公式コンポーネント群 → get-convex の README は開発者による追跡。R2 Upload → multipart/Workers limits → lifecycle/イベント/Queues、Cloudflare Observability → 型・環境・復旧の資料も保存。
- 検索役: 0本。すべて親が調査。Context7 の resolver 3本・docs 3本はすべて終了済み。保存用 subprocess 群もすべて終了した。待たずに放置した探索はない。
- Context7 はクォータ・DNS エラー無し。npm の設定警告（auto-install-peers / strict-peer-dependencies）は出たが、取得は成功。
- HTML変換で約8千文字で終わる保存結果が複数あった。全文の代わりとして扱わず、公式 Markdown URL に切り替えて取得し直した。例: Convex 検索で日本語 token 化の制約の節が、Markdown 全文の取得後に読めた。取得ツールや skill 自体は変更していない。
- Convex component ページは58文字の本文しか得られず FAIL。公式 GitHub の README に置換して成功。404 の URL は公式ドキュメント・検索から現在の場所へ修正した。失敗・成功は fetch-log.jsonl に全件記録。
- Turnstile は公式トップと公式 raw MDX で captcha という語を壁と判定して FAIL。製品説明にも現れる語なので検出誤りの可能性。回避のため取得器の制御は変更せず、具体的導入仕様を未評価にした。
- 既存実装に Range/ETag、認可問い合わせ集約、PWA差分再利用、通知予約、冪等移行、domain pack があることを確認し、未導入として数えない。
- 検索索引は既存だが、日本語部分一致の単純置換はできない。通知の予約済み action と、失敗時の再試行保証も分けて扱った。
- 依頼に「分析・リストアップ」が含まれるため、スキルの「まとめを頼まれたら書く」に従い、評価を analysis.md に記載した。sources/ は原文だけを保存し、評価・要約ファイルを混ぜない。

## 終了判断

- 止めた理由: 1周目に、6つの問いすべてへ原文の場所と短い引用が付いた。原文のリンクと公式開発者の別資料への追跡も実施済み。
- 検索役がいないため、飽和率の分子/分母は計算しない。全製品・全APIの網羅や実測済みを意味する終了ではない。
- 未到達: クラウド管理画面の実設定・プラン・実データ規模・性能/費用、workRoles の本番同期、Cloudflare Vite plugin と Vite+ 1.2.0 の実動互換性、Turnstile の原文保存。
- アプリ・設定・依存・本番資源は変更していない。アプリのテスト・負荷試験・デプロイ・データ移行は実行していない。調査開始時からの .node-version の変更はそのまま。
- 出力: analysis.md（42候補・採用境界7件）、current-evidence.md（コードの位置）、map.md、report.html、extracts.json、sources.json（URL・行数・SHA-256）、原文。

- 保存済み公式原文: 56本（cloudflare: 27, convex: 17, vite: 12）。

## 利用者の感覚との照合

返答待ち。受け取ったら言い換えずに追記する。

## 提出物の確認

- 抜き書き19件は原文照合成功。42候補・7境界を集計。保存原文と sources.json は56本で一致。
- 日本語の lint・資料との照合と最終稿のハッシュ照合を実施。詳細は review.md。分類ID・優先度は分析者の判断として本文に明記。
- アプリのコードは未変更。実装のテストは行っていない。
