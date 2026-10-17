# Figma と Web サイトの校正を本体で行う — 要件調査（叩き台）

> 版: 0.2（2026-10-17） / 状態: **MVP（Phase 0＋1）＋ Figma の REST API 取り込み（Phase 2 の FG-05）を実装済み**（決定ログ「Figma・Web の校正（本体で）」、docs/UI_M3E.md §55）。利用者決定 2026-10-17: 委員会の Figma は Education プラン。「API が使えるならまずはそっちで試す」→ 取り込みを先に、iframe の埋め込みはフレーム単位のコメントの代わりの手段。承認事項（§5）のうち 1（プラン）・2（API の利用）は利用者が承認。**トークン（`FIGMA_ACCESS_TOKEN`）を Worker の秘密に置くのは利用者の手順**（この環境では本物の Figma API を呼んでいない）。残り（書き戻し・Browser Rendering・プロキシ・スニペット設置）は未承認でポリシー値のまま。実装の状態は §10
> 利用者の指示: 「Figma をこの校正システム内で開いて校正ができるようにしたい。実際のウェブサイトを校正システム内で表示して、位置を合わせてコメントが入れられるような形（レスポンシブ対応、デバイス対応）でお願いしたい。しっかりと要件を調べて。」
> 位置づけ: 要件 v1.1 の確定方針 C5（「動画・Web・Figma などは外部ツールでの作業を許容する」）を、動画（docs/UI_M3E.md §53、決定ログ「動画の校正（本体で）」）に続いて Figma・Web にも広げる提案。F-10（外部リンクと議論結果の記録）は残し、その上に「本体で位置を指してコメントする」手段を足す。§9.3「外部コメントを完全同期したと誤認させない」は維持する。
> 調査の方法: この環境では WebFetch が全ホストで名前解決に失敗したため、外部の情報は WebSearch の結果要約から取った。一次資料を直接読めていない箇所は「※要確認」と明記した。コード側の事実（Anchor 型・Artifact 型・DEVICES・Hono ルート・デモモード）はリポジトリを読んで確認した。

## 0. 要点（先に結論）

| 項目           | 結論                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Figma          | **ライブ埋め込みの上に位置コメントは付けられない**（iframe は別オリジン、Embed API は画面座標を返さない・ログイン済み Figma ユーザーが前提）。他社（Ziflow 等）と同じく **選んだフレームを画像に書き出して版に固定し、既存の画像の矩形・ピンで校正**する。書き出しは手動（制作者が PNG/PDF を添付）から始め、Figma REST API（`GET /v1/images`）による自動取り込みは **OAuth アプリ登録・プラン確認の承認後**。埋め込みは「文脈を見る」用途（任意）。コメントから Figma のそのノードへのディープリンクは API なしで出せる                                                                                                                                          |
| Web            | 任意のサイトを iframe に入れるのは X-Frame-Options / CSP frame-ancestors / 別オリジン制約で**一般には不可能**。他社は「プロキシで書き換えて表示」「サイトにスニペットを置く」「拡張機能」「スクリーンショット」の 4 通り。本件では **(1) 版の提出時に端末幅ごとのスクリーンショットを撮って不変の添付にする（既存の image_rect/pin で校正。要 Cloudflare Browser Rendering＝課金承認）**、**(2) 委員会が管理するサイト（公式サイト等）には小さなブリッジスクリプトと frame-ancestors を置いてライブ表示＋DOM 要素に結び付くコメント（新アンカー `web_element`）**、**(3) 外部サイトのプロキシ表示は許可リスト（ポリシー値・承認制）付きの後続**の順に段階導入する |
| 端末           | SNS プレビューの `features/social/preview/devices.ts`（iPhone 実機ベゼル・Android・PC）をそのまま再利用し、タブレットと PC の代表幅を足す。iframe は実機の CSS ピクセルで組み、表示だけ縮める（PostPreview の `useFitScale` と同じ）。**UA・DPR・タッチは iframe では偽装できない**（スクリーンショット側では可能）                                                                                                                                                                                                                                                                                                                                               |
| 承認が要るもの | Figma OAuth アプリ登録と委員会の Figma プラン・シート確認、Figma への書き戻し（外部への実データ送信）、Cloudflare Workers Paid（Browser Rendering）、プロキシ許可リストと専用オリジン、委員会サイトへのスニペット設置                                                                                                                                                                                                                                                                                                                                                                                                                                             |

---

## 1. 背景・目的

- As-Is（要件 §1.2）: 校正者は Slack のリンクから Figma / サイトを開き、Figma のコメントや口頭で指摘する。結果は本体に「外部の議論の記録」（`external` アンカー）として残すだけで、**位置が特定できず、版と指摘の対応・採否・持越しが追えない**（C1 の目的に反する）。
- 五月祭の制作物のうち Web（公式サイト・特設ページ）と Figma（UI・配布物のデザイン）は、PDF 化すると壊れる（レスポンシブ・インタラクション・実機の見え方）。
- 目的: **PDF・画像・文章・動画と同じ校正ワークスペース（U-05）で、Figma のフレームと Web ページの「場所」を指してコメントし、版・採否・校了のガードにつなげる。** 外部ツールでの議論（F-10）は排除しない。

## 2. 調査結果

### 2.1 Figma

#### 2.1.1 埋め込み（Embed Kit）

| 観点                        | 分かったこと                                                                                                                                                                                                                                                                                                                                                                                                                                            | 出典                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                         | Embed Kit 1.0: `https://www.figma.com/embed?embed_host=...&url=...`。Embed Kit 2.0: ファイルの URL の `www` を `embed` に替える（`https://embed.figma.com/design/:key/:name?node-id=..&embed-host=<名前>`、`/proto/` はプロトタイプ）。`embed-host` は必須。2.0 は `embed_origin` 以外の 1.0 のパラメータを全部受ける。1.0 の廃止期日は見つからなかった                                                                                                 | developers.figma.com/docs/embeds/resources、/docs/embeds/embed-figma-file、/docs/embeds/embed-figma-prototype                                                                                  |
| パラメータ                  | `node-id`（表示するノード）、`hide-ui=1`（Figma の UI を隠す）、`scaling`（例 `min-zoom`）、`content-scaling=fixed`、`starting-point-node-id`（プロトタイプの開始フレーム）、`footer=false`（フッターを隠す。公式記載が見つからず ※要確認）                                                                                                                                                                                                             | 同上、forum.figma.com                                                                                                                                                                          |
| Embed API（制御・イベント） | OAuth アプリを作り `client-id` を URL に付け、「許可する埋め込みオリジン」を登録する。登録したオリジンとだけ postMessage をやり取りする。**プロトタイプ向け**: 送れるのは `NAVIGATE_FORWARD` / `NAVIGATE_BACKWARD` / `RESTART` など、受けるのは `INITIAL_LOAD`・`NEW_STATE`・`PRESENTED_NODE_CHANGED`（`presentedNodeId`）・`MOUSE_PRESS_OR_RELEASE`（`targetNodeId`。座標が null で返る報告あり）。`LOGIN_SCREEN_SHOWN` 等は検索では確認できず ※要確認 | developers.figma.com/docs/embeds/embed-api、github.com/figma/embed-kit-2.0-example、forum.figma.com（how-to-listen-for-frame-changes-in-embed、mouse-press-or-release-returns-null-positions） |
| ログイン要件                | **Embed API のイベントはログイン済みの Figma ユーザーにしか届かない**（2026-01 の Figma サポート回答。匿名でも動くよう検討中とのこと）。表示自体はファイルの共有設定に従う: 組織内共有のファイルはログイン必須、リンク共有が「リンクを知っている全員」なら権限なしで見られる、パスワード付きはパスワード入力（古いヘルプは「埋め込み不可」と矛盾 ※要確認）。Figma のクッキーがブロックされると「Figma で開く」に逃がす                                  | developers.figma.com/docs/embeds/security-access、help.figma.com/hc/en-us/articles/360040531773、forum.figma.com（prototype-embed-api-does-not-fires-events-without-figma-session）            |
| 制約                        | **デザインファイルの埋め込みからは、クリック位置のピクセル座標・表示中の拡大率・スクロール位置は取れない**（別オリジン iframe）。得られるのはプロトタイプのノード ID まで。よって「埋め込みの上にピンを置く」は、ノード単位（「このフレームについて」）までが限界                                                                                                                                                                                       | 上記の総合                                                                                                                                                                                     |

#### 2.1.2 REST API

| 項目                              | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 出典                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 認証                              | 個人アクセストークン（PAT）は **2025-04-28 以降、有効期限最大 90 日・無期限は作れない**。OAuth 2: `POST /v1/oauth/refresh` で更新、`expires_in` は資料により 24h／90 日と食い違う ※要確認。スコープは細分化（`files:read` は非推奨 → `file_content:read`、`file_comments:read` / `file_comments:write`、`file_versions:read` 等）                                                                                                                            | developers.figma.com/docs/rest-api/changelog、/docs/rest-api/authentication                      |
| ファイル取得                      | `GET /v1/files/:key`（`version`・`ids`・`depth`・`geometry`。応答に `version`・`lastModified`・ノード木。各ノードに `absoluteBoundingBox`）、`GET /v1/files/:key/nodes?ids=`、`GET /v1/files/:key/meta`                                                                                                                                                                                                                                                      | developers.figma.com/docs/rest-api/file-endpoints                                                |
| 画像の書き出し                    | `GET /v1/images/:key?ids=..&scale=0.01〜4&format=png                                                                                                                                                                                                                                                                                                                                                                                                         | jpg                                                                                              | svg | pdf&use_absolute_bounds=`。**返る URL は一時的（約 30 日）→ R2 に保存して使う**。最大 32 メガピクセル（超えると縮小） | 同上（公式ページは取得できず、複数の二次資料で一致。※要確認） |
| コメント                          | `GET /v1/files/:key/comments`（`as_md`）、`POST`（`message`、返信は `comment_id`、位置は `client_meta`: `Vector{x,y}`（キャンバス座標）／`FrameOffset{node_id, node_offset{x,y}}`（**フレーム左上からのオフセット**）／`Region`・`FrameOffsetRegion`（`region_width/height>0`、`comment_pin_corner` 既定 bottom-right））、`DELETE`。**解決（resolve）は API からできない**。`client_meta` が null で返ることがある                                          | developers.figma.com/docs/rest-api/comments-endpoints、/comments-property-types、forum.figma.com |
| 版                                | `GET /v1/files/:key/versions`（`page_size` 既定 30、`before`/`after`、`pagination.next_page`）。**Starter チームは 30 日分の履歴しか見られない**。`GET /v1/files/:key?version=<id>` で過去版の木、`/v1/images` も `version` 指定可                                                                                                                                                                                                                           | forum.figma.com/t/how-to-fetch-all-the-versions-of-a-file-using-the-rest-api、二次資料           |
| Webhook v2                        | `FILE_COMMENT`・`FILE_UPDATE`・`FILE_VERSION_UPDATE` 等。チーム/プロジェクト/ファイルの文脈。resolve では発火しない                                                                                                                                                                                                                                                                                                                                          | developers.figma.com/docs/rest-api/webhooks、/webhooks-types                                     |
| **レート制限（2025-11-17 改定）** | 「シート種別 × エンドポイントの Tier × **資源（ファイル）が属するプラン**」で決まる。Tier 1＝ファイル内容・画像の取得、Tier 2＝コメント・Webhook 等、Tier 3＝分析。ヘルプセンターの表（読み取りにぶれあり ※要確認）: Tier 1 は **Starter プランのファイルは 6〜20 回/月**（Full シートでも）、Professional の Dev/Full シートで 10 回/分、Organization 15/分、Enterprise 20/分、View/Collab シートは 6 回/月。Tier 2 は Pro Dev/Full 25/分、View/Collab 5/分 | developers.figma.com/docs/rest-api/rate-limits、help.figma.com/hc/en-us/articles/34963238552855  |

**含意**: 委員会の Figma が **Starter（無料）なら REST API による自動取り込みは月数回しか動かず実用にならない**。Professional 以上で、トークンの持ち主が Dev/Full シートである必要がある。これは最初に確認する事項（§8 Q1）。`/v1/images` は 1 リクエストで複数 `ids` を渡せるので、1 版＝1 リクエストに収めればレート制限内に入る。

#### 2.1.3 他社ツールの Figma 対応

| ツール                     | 方式                                                                                                                                                                                              | 位置の持ち方             | 版の扱い                                      | 出典                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------- |
| Ziflow（Figma プラグイン） | フレーム/アートボードを **PNG か PDF の固定スナップショット**として校正に送る。PDF なら文字選択可。校正者は Figma シート不要。プラグイン利用者は Figma の有料 Full シートが必要（Public Preview） | スナップショット上の座標 | 新版は同じ proof に追加、指摘は版ごとに紐付く | help.ziflow.com/hc/en-us/articles/41800168997140、ziflow.com/integrations/figma |
| Ziflow（URL 貼付）         | Figma の URL は「ライブ Web サイト」として扱うだけ。公開ファイル限定                                                                                                                              | —                        | —                                             | 同上                                                                            |
| Workflow（design review）  | 本体のコメント → Figma へ一方向同期。Figma 側のコメントは戻らない                                                                                                                                 | Figma の node            | —                                             | workflow-design.hc.ferndesk.com                                                 |
| Commentful / Komentiq      | Figma ネイティブのコメントを整理・取り込み。ファイル複製時の再リンク機能あり                                                                                                                      | Figma 側                 | Figma 側                                      | docs.hypermatic.com、index.dodopayments.com/komentiq                            |
| Figma 自身                 | コメントの JSON 書き出し／別ファイルへの取り込み（手動）                                                                                                                                          | `client_meta`            | 版履歴は別機能                                | websitebuilderinsider.com（Figma ヘルプの要約）                                 |
| Markup.io                  | .fig 非対応、PDF に書き出して校正（レビュー記事）                                                                                                                                                 | 画像/PDF 座標            | ファイル版                                    | g2.com                                                                          |

共通点: **成熟したツールほど「スナップショットを固定して校正する」**。ライブ埋め込みに位置コメントを載せている例は見つからなかった。

### 2.2 Web サイト

#### 2.2.1 技術制約

| 制約               | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 出典                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| フレーム拒否       | `X-Frame-Options: DENY/SAMEORIGIN` と CSP `frame-ancestors`（両方あれば CSP が優先、合わなければ厳しい方）。`ALLOW-FROM` はどのブラウザも非対応。多くのサイト（CMS 既定・ログイン画面）が付けている                                                                                                                                                                                                                                                                                                                                          | securityscientist.net、really-simple-ssl.com、caniuse.com/x-frame-options                                                                                                                |
| 別オリジン         | 親ページから iframe の DOM・スクロール・クリック位置は読めない。要素を指すには **iframe の中で動くスクリプト**（スニペット設置かプロキシでの注入）が必要                                                                                                                                                                                                                                                                                                                                                                                     | Web 標準                                                                                                                                                                                 |
| クッキー           | Safari は第三者クッキーを既定で遮断。Chrome は 2025-04-22 に「第三者クッキーの既定遮断をしない」と決定（設定で遮断可、Incognito は遮断）。CHIPS（Partitioned）は継続。→ iframe の中でログインが必要なステージングは Safari で崩れる                                                                                                                                                                                                                                                                                                          | privacysandbox.google.com/blog/privacy-sandbox-next-steps、stape.io                                                                                                                      |
| 混在コンテンツ     | https の親に http のサイトは入らない（他社も「HTTPS で配信」を条件に挙げる）                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | help.filestage.io/en/articles/5755764                                                                                                                                                    |
| Workers からの取得 | Workers のサブリクエストは **IP アドレス直指定は不可（ホスト名のみ）**、localhost は Cloudflare 側を指す。私的ネットワークは Workers VPC（beta）経由のみ。→ SSRF 面では有利だが、許可リストは別に要る                                                                                                                                                                                                                                                                                                                                        | developers.cloudflare.com/workers/platform/known-issues、/workers-vpc                                                                                                                    |
| スクリーンショット | Cloudflare Browser Rendering: REST `/screenshot`（`url` or `html`、`viewport`（既定 1920×1080）、`fullPage`、`clip`、`gotoOptions`、`waitFor*`、`cookies`、`authenticate`、`screenshotOptions.omitBackground`）。`/snapshot` は HTML と画像を同時に返す。Workers Binding（Puppeteer 互換）なら `page.emulate`（UA・DPR・isMobile）や `page.evaluate` で要素の矩形も取れる。**料金**: 2025-08-20 から課金。Workers Free は 10 分/日・同時 3。Workers Paid は 10 時間/月込み、超過 $0.09/時間、REST は 600 回/分（2026-03 に 3 倍化）、同時 30 | developers.cloudflare.com/browser-rendering/limits、/changelog（2025-07-28-br-pricing、2026-03-04-br-rest-api-limit-increase）、/api/resources/browser_rendering/subresources/screenshot |

#### 2.2.2 他社ツールの方式比較

| ツール              | 表示方式                                                                                                                                                                                                                                              | コメントの位置                       | レスポンシブ/端末  | 版                                 | 出典                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Pastel              | **独自プロキシ**でライブサイトを表示、上にコメント層。「どんなサイトでも」と謳うが、読み込めない・Google Maps iframe が出ない・フォント欠け等の報告                                                                                                   | 画面上のピン                         | —                  | ライブ（サイト更新で自動反映）     | help.usepastel.com/en/articles/1996011、feedbucket.app、getapp.de                                     |
| Ruttl               | 拡張不要、ブラウザから URL を入れて表示（`proxy.ruttl.com` 配下の URL が存在＝プロキシ）                                                                                                                                                              | ピン、要素の CSS 編集                | —                  | ライブ                             | ruttl.com、live--http--docs-emmet-io.proxy.ruttl.com                                                  |
| Filestage           | **サイト側に X-Frame-Options/CORS で `*.filestage.io` を許可してもらう**（または外す）。閲覧モードと**コメントモード（切り替え時にスクリーンショットを撮り、その上をタップ）**。注釈にはブラウザ拡張（Chrome/Firefox/Edge）推奨。**旧版は保持しない** | スクリーンショット座標               | —                  | ライブのみ                         | help.filestage.io/es/articles/5755744、/en/articles/5755764                                           |
| Ziflow              | **スナップショット（1920px 幅で固定）とライブの 2 モード**。ライブは「操作モード」と「コメントモード」、**解像度メニュー（十数種）と回転**、更新・ホーム                                                                                              | スナップショット座標／ライブ画面座標 | 解像度の切替・回転 | スナップショットは版、ライブは最新 | help.ziflow.com/hc/en-us/articles/30721884888212、/en/articles/7052650                                |
| BugHerd             | サイトにスクリプト設置か拡張。ピンは **HTML 要素に貼る（CSS セレクタ）**。画面解像度・ブラウザ・OS・スクリーンショットを記録                                                                                                                          | CSS セレクタ＋メタ                   | 記録のみ           | ライブ                             | bugherd.com/bug-tracker-developers-new、dupple.com/tools/bugherd                                      |
| Marker.io           | ウィジェット／拡張。スクリーンショット、OS・ブラウザ・解像度・ビューポート・DPR・ズーム、コンソールログ、セッション録画。要素単位の捕捉は要望段階                                                                                                     | スクリーンショット座標＋メタ         | 記録のみ           | ライブ                             | help.marker.io（snippet-configuration、widget-javascript-sdk）、feedback.marker.io                    |
| Atarim              | スニペット（WordPress 中心）。**レスポンシブモード: デスクトップ／タブレット 768×1024／モバイル 390×844（縦のみ）**、**フィードバックに閲覧時の幅を記録**                                                                                             | 要素＋幅                             | 3 段階の幅切替     | ライブ                             | atarim.io/help/visual-collaboration/responsive-testing-managing-feedback-across-device-breakpoints    |
| Feedbucket          | 端末切替の擬似表示は**提供しない**（実機で送る方針）                                                                                                                                                                                                  | —                                    | 実機               | ライブ                             | help.feedbucket.app                                                                                   |
| Userback / Usersnap | ウィジェット。ページ・ブラウザ・端末・画面サイズを自動記録、ピンの可視化                                                                                                                                                                              | 画面座標＋メタ                       | 記録のみ           | ライブ                             | trustradius.com、usersnap.com                                                                         |
| Vercel Toolbar      | 自社デプロイにツールバー注入。`c` でクリック位置か**文字選択**にコメント。プレビューデプロイごと（＝ブランチ＝版）に紐付き、PR に同期。Content-Type が HTML のときだけ                                                                                | クリック位置／テキスト範囲           | —                  | **デプロイ＝版**                   | vercel.com/docs/comments、/docs/comments/how-comments-work                                            |
| Webflow             | デザイナーのキャンバス上にピン。2025-11 からコメント専用リンクで外部レビュー、**ブラウザと画面サイズをメタとして記録**                                                                                                                                | キャンバス座標                       | 記録               | —                                  | webflow.com/updates/see-comments-on-the-canvas-while-you-work、university.webflow.com/videos/comments |

#### 2.2.3 位置の表し方（アンカー）の標準

- W3C Web Annotation Data Model のセレクタ（`CssSelector`、`XPathSelector`、`TextQuoteSelector{exact,prefix,suffix}`、`TextPositionSelector`、`RangeSelector`）を**重ねて持ち**、1 つ崩れても別の層で解決する。Hypothesis は RangeSelector(XPath) → TextPosition → TextQuote（文脈付きのあいまい一致）の順で再アンカーし、段落削除や大幅な書き換えには耐えない。出典: web.hypothes.is/blog/fuzzy-anchoring、w3.org/2014/04/annotation/slides/RobustAnchoring.pdf、wal.sh/research/annotation-systems。
- 実務ツールは **CSS セレクタ＋要素内の相対位置＋スクリーンショット＋閲覧時のビューポート**を保存し、見つからなければ「位置が外れた」状態で一覧に残す（BugHerd・Atarim の方式の総合）。

#### 2.2.4 端末プリセット

- 既存資産: `apps/web/src/features/social/preview/devices.ts` の `DEVICES`（iPhone 18 Pro／Pro Max／17 系／Air／16 系（Apple 公式ベゼル PNG、`public/devices/*.webp`）、Android、PC）、`DevicePicker`（`localStorage` に端末を記憶）、`PostPreview` の `useFitScale`（CSS ピクセルで組み `zoom` で縮める）、安全領域 `top/bottom`、角丸、カットアウト。決定ログ「SNS プレビューの端末」（2026-10-15）。
- 追加候補: タブレット（iPad 10.9: 820×1180 / iPad Pro 11: 834×1194 など）、PC の代表幅（1280・1440・1920）、横向き。数値は Playwright の `packages/isomorphic/deviceDescriptorsSource.json`（Chrome DevTools と同じ値。例 iPhone 15 は 393×659・DPR 3 ※二次資料）から取る。
- iframe での限界: UA・DPR・タッチイベント・Safari 固有の描画は偽装できない（Chromium のみ `isMobile` を尊重、しかもテストランナー側の機能）。**実機の確認は別途**（Feedbucket の方針と同じ）と画面に明記する。スクリーンショット（Browser Rendering）側では UA・DPR・isMobile を設定できる。

#### 2.2.5 Web の「版」の定義（他社の整理）

- Filestage: ライブのみ、旧版なし。Ziflow: スナップショット＝固定、ライブ＝最新。Vercel: デプロイ URL＝版。
- 本件の要件 C2/D1（版の提出確定で旧版を閉じる、確定した版のファイルを無言で差し替えない）に合わせるなら、**版＝「URL ＋ 提出確定時のスナップショット一式（端末幅ごと）」**。ライブ表示は「今のサイト」で、版の内容を表すのはスナップショット。ステージング URL を版ごとに変える運用（Vercel 型）が取れるならそれが最も堅い。

### 2.3 出典一覧（URL）

Figma: https://developers.figma.com/docs/embeds 、https://developers.figma.com/docs/embeds/embed-api 、https://developers.figma.com/docs/embeds/embed-kit-2.0/ 、https://developers.figma.com/docs/embeds/security-access 、https://developers.figma.com/docs/embeds/resources 、https://developers.figma.com/docs/embeds/embed-figma-file 、https://developers.figma.com/docs/embeds/embed-figma-prototype 、https://github.com/figma/embed-kit-2.0-example 、https://developers.figma.com/docs/rest-api/rate-limits 、https://help.figma.com/hc/en-us/articles/34963238552855-What-if-I-m-rate-limited 、https://developers.figma.com/docs/rest-api/changelog 、https://developers.figma.com/docs/rest-api/comments-endpoints/ 、https://developers.figma.com/docs/rest-api/comments-property-types 、https://developers.figma.com/docs/rest-api/file-endpoints/ 、https://developers.figma.com/docs/rest-api/webhooks 、https://developers.figma.com/docs/rest-api/webhooks-types 、https://help.figma.com/hc/en-us/articles/360040531773-Share-or-embed-files-and-prototypes 、https://forum.figma.com/ask-the-community-7/prototype-embed-api-does-not-fires-events-without-figma-session-48360 、https://forum.figma.com/t/how-to-listen-for-frame-changes-in-embed/66834 、https://forum.figma.com/ask-the-community-7/embed-kit-2-0-mouse-press-or-release-returns-null-positions-36790 、https://forum.figma.com/t/how-to-fetch-all-the-versions-of-a-file-using-the-rest-api/93342 、https://forum.figma.com/t/issue-client-meta-returning-null-in-comment-api-response/86965 、https://forum.figma.com/report-a-problem-6/rest-api-rate-limit-images-api-returns-429-after-10-requests-cloudfront-49021
Figma 系ツール: https://help.ziflow.com/hc/en-us/articles/41800168997140 、https://www.ziflow.com/integrations/figma 、https://workflow-design.hc.ferndesk.com/how-to-use-the-figma-integration-in-workflow-m0t4f 、https://docs.hypermatic.com/commentful/tutorials/supercharge-and-organize-your-figma-comments
Web 系ツール: https://help.usepastel.com/en/articles/1996011-reviewing-websites-in-pastel 、https://ruttl.com/competitors 、https://help.filestage.io/es/articles/5755744-review-live-websites 、https://help.filestage.io/en/articles/5755764-setting-up-your-website-for-live-review 、https://help.ziflow.com/hc/en-us/articles/30721884888212 、https://help.ziflow.com/en/articles/7052650-proof-websites-in-ziflow-dashboard-2-0 、https://bugherd.com/bug-tracker-developers-new 、https://help.marker.io/en/articles/13685821-snippet-configuration 、https://help.marker.io/en/articles/4621840-widget-javascript-sdk 、https://atarim.io/help/visual-collaboration/responsive-testing-managing-feedback-across-device-breakpoints/ 、https://help.feedbucket.app/en/article/main-differences-between-feedbucket-and-other-feedback-tools-1gr7txk 、https://vercel.com/docs/comments 、https://vercel.com/docs/comments/how-comments-work 、https://webflow.com/updates/see-comments-on-the-canvas-while-you-work 、https://help.pageproof.com/en/articles/1374140-x-frame-options-in-headers-explained
標準・ブラウザ: https://web.hypothes.is/blog/fuzzy-anchoring/ 、https://www.w3.org/2014/04/annotation/slides/RobustAnchoring.pdf 、https://privacysandbox.google.com/blog/privacy-sandbox-next-steps 、https://www.caniuse.com/x-frame-options
Cloudflare: https://developers.cloudflare.com/browser-rendering/limits/ 、https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/ 、https://developers.cloudflare.com/changelog/post/2026-03-04-br-rest-api-limit-increase 、https://developers.cloudflare.com/api/resources/browser_rendering/subresources/screenshot/methods/create 、https://developers.cloudflare.com/browser-rendering/quick-actions/snapshot 、https://developers.cloudflare.com/workers-vpc/ 、https://developers.cloudflare.com/workers/platform/known-issues/
端末: https://qaskills.sh/blog/playwright-devices-list-mobile-emulation-guide 、https://docs.checklyhq.com/learn/playwright/emulating-mobile-devices

---

## 3. 機能要件

優先度: Must＝初回の現場試験で必要、Should＝試験中に欲しい、Could＝後続。

### 3.1 共通（CM）

| ID    | 要件                                                                                                                                                                                                                    | 優先度 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| CM-01 | Figma・Web の制作物でも、PDF/画像/動画と同じ校正ワークスペース（左に紙面、右にコメント、印とスレッドの双方向リンク、版・残り時間・校正対象者の常時表示）を使う                                                          | Must   |
| CM-02 | 版の内容は提出確定時に**不変の添付**（書き出し画像／スクリーンショット）として固定し、校正受付・採否・持越し・校了ガード（C2/C6/F-08/F-09）は既存の仕組みをそのまま使う。確定した版の添付は無言で差し替えない（§5.2-6） | Must   |
| CM-03 | 外部（Figma 本体・ライブサイト）の内容が版の内容と違い得ることを画面に明示する（「ライブ表示は今の内容。この版の内容はスナップショット」）。外部コメントを同期済みと誤認させない（§9.3 / A-12）                         | Must   |
| CM-04 | 外部リンクと議論結果の記録（F-10、`external` アンカー）は従来どおり併用できる                                                                                                                                           | Must   |
| CM-05 | デモモード（convex-test・ネットワーク無し）でも同じ画面が動く（固定の見本データ・同一オリジンの見本サイト）                                                                                                             | Must   |
| CM-06 | 通知から開いたとき、該当のフレーム／端末幅／要素へ移って該当コメントを開く（ページ送り・動画の時刻と同じ）                                                                                                              | Should |

### 3.2 Figma（FG）

| ID    | 要件                                                                                                                                                                                                                                                              | 優先度           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| FG-01 | 版の提出で Figma の URL（`figma.com/design/:key/...?node-id=`）を登録でき、ファイルキーとノード ID を解析して保持する                                                                                                                                             | Must             |
| FG-02 | 校正対象のフレームを**画像として版に固定**できる。初期は制作者が Figma から書き出した PNG/PDF を添付（既存の `image`/`pdf` 添付）。添付に Figma の由来情報（`fileKey`・`nodeId`・ノード名・取得時刻・`version`）を付けられる                                      | Must             |
| FG-03 | 固定した画像の上で既存の矩形・ピン（`image_rect`/`image_pin`、PDF なら `pdf_*`）でコメントできる                                                                                                                                                                  | Must             |
| FG-04 | コメントや添付から **Figma のそのノードへのディープリンク**（`https://www.figma.com/design/:key/:name?node-id=X-Y`）を出す（API 不要）                                                                                                                            | Must             |
| FG-05 | **自動取り込み**: 登録した URL から `GET /v1/files/:key/nodes` と `GET /v1/images/:key`（`scale` 2、PNG）でフレームを描き、R2 に保存して版の添付にする。1 版 1 リクエストにまとめ、429 は `Retry-After` を尊重。失敗は添付の `failed` に理由を残す（F-04 と同じ） | Should（承認後） |
| FG-06 | 取り込み時に Figma の `version`・`lastModified` を保存し、同じノードの前版との**差し替え**で画像比較（既存の版比較）に載せる。同じ `nodeId` の添付同士を比較の既定ペアにする                                                                                      | Should           |
| FG-07 | 文脈確認用に Figma の**埋め込み表示（Embed Kit 2.0、`hide-ui=1`）**を紙面の切替で出せる。埋め込みの上にはコメントを置かない（置けない理由を画面で説明）。Figma 側のログイン要求・アクセス不可は検知できないので「Figma で開く」リンクを常に併置                   | Could            |
| FG-08 | Figma 側のコメント（`GET /v1/files/:key/comments`）を読み取り専用で一覧に出す（本体のコメントと区別、同期状態の明示）。Figma へのコメント書き戻し（`POST` FrameOffset/Region）は採否判断が確定したものに限り、明示操作で行う                                      | Could（承認後）  |
| FG-09 | 複数フレームの版は、フレームの一覧（ページ送りと同じ UI）で切り替え、コメントの印はフレームごとに出す                                                                                                                                                             | Must             |
| FG-10 | プロトタイプ URL（`/proto/`）は埋め込み表示のみ対応、コメントは「このフレーム（ノード）について」の単位                                                                                                                                                           | Could            |

### 3.3 Web サイト（WB）

| ID    | 要件                                                                                                                                                                                                                                                                                                                                    | 優先度                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| WB-01 | 版の提出で対象 URL（複数ページ可）を登録し、**提出確定時に端末幅ごとのフルページスクリーンショット**を撮って不変の添付にする（既定: スマホ 1 種・PC 1 種、設定で追加）                                                                                                                                                                  | Must（撮影は Browser Rendering の課金承認後。承認前は制作者がスクリーンショットを添付） |
| WB-02 | スクリーンショットの上で既存の矩形・ピンでコメントできる。添付に撮影条件（URL・端末・ビューポート・DPR・UA・撮影時刻・フルページか）を持つ                                                                                                                                                                                              | Must                                                                                    |
| WB-03 | **ライブ表示**: 紙面に iframe でサイトを出し、端末プリセット（§2.2.4）で幅・高さ・安全領域・ベゼルを切り替え、回転でき、実寸を枠に合わせて縮小表示する。幅はピクセルで直接も指定できる                                                                                                                                                  | Must                                                                                    |
| WB-04 | ライブ表示の中で**ブリッジスクリプト**が動くサイト（委員会のサイトにスニペットを置く／プロキシで注入）では、閲覧モードとコメントモードを切り替え、コメントモードで要素を押す・なぞると、要素の CSS セレクタ・XPath・引用文・要素内の相対位置・ビューポート・スクロール位置・URL を取り、`web_element` アンカーで保存する                | Must（スニペット方式）／Should（プロキシ方式）                                          |
| WB-05 | 保存した `web_element` を表示時に再アンカーする（CSS セレクタ → XPath → 引用文のあいまい一致 → ページ座標）。見つからなければ「位置が外れた」印とカードの注記を出し、消さない。別の端末幅で開いたときは同じ要素の今の位置に印を出し、カードに「iPhone 17（402px）で付けたコメント」と元の幅を出す                                       | Must                                                                                    |
| WB-06 | コメント時に、その要素の切り抜き画像（Browser Rendering の `clip`、同じビューポート設定）を補助添付として保存し、カードに出す（ライブの内容が変わっても何を指したかが残る）                                                                                                                                                             | Should                                                                                  |
| WB-07 | ブリッジが動かないサイト（X-Frame-Options 等で入らない／スニペット未設置）は、ライブ表示を諦めてスナップショットだけで校正し、理由（「このサイトは埋め込みを拒否しています」）を画面に出す。埋め込み拒否は iframe の `load` 後にブリッジの `ready` が来ないことで判定（直接は検知不可）                                                 | Must                                                                                    |
| WB-08 | **プロキシ表示**（`/web-proxy`）: 許可リスト（ポリシー値）に載ったホストだけ、API ワーカーが取得して HTML を書き換え（絶対 URL 化・`<base>`・フレーム拒否ヘッダーと CSP の除去・ブリッジの注入）、**アプリとも API とも別の専用オリジン**から配信する。クッキー・Authorization は転送しない。https のみ、リダイレクトも許可リスト内のみ | Could（承認後）                                                                         |
| WB-09 | 文字範囲のコメント（選択した文字列を `textQuote` で保持）に対応し、文章校正の `text_range` と同じ見せ方にする                                                                                                                                                                                                                           | Should                                                                                  |
| WB-10 | 版比較（既存）でスナップショット同士を横並びにし、同じ端末幅の添付を既定ペアにする                                                                                                                                                                                                                                                      | Should                                                                                  |
| WB-11 | 版ごとに違う URL（ステージング／プレビューデプロイ）を登録でき、版のカードに URL を出す                                                                                                                                                                                                                                                 | Should                                                                                  |
| WB-12 | ライブ表示では実機の UA・DPR・タッチ・Safari 固有の挙動は再現されないことを端末の説明文に出す（既存の `PostPreview` の「実寸の n% で表示」と同じ場所）                                                                                                                                                                                  | Must                                                                                    |

## 4. 非機能要件

- **セキュリティ**
  - プロキシは **アプリ（Nogiku のセッション・Convex のトークンを持つオリジン）と同一オリジンにしない**。注入したサイトのスクリプトが親の `localStorage`/Cookie に触れないよう、専用オリジン（例 `proof.<ドメイン>`）から配信し、親とは `postMessage` の `origin` 検査で通信する。iframe には `sandbox="allow-scripts allow-same-origin allow-forms"` を付け、`allow-top-navigation` は付けない。
  - SSRF: 許可リストはホスト名の完全一致（ワイルドカードは明示登録）。https のみ、ポート 443 のみ、IP 直指定・`localhost`・`.internal` を拒否、リダイレクトは再検査。Workers のサブリクエストは IP 直指定不可・私的ネットワーク不到達（VPC 以外）だが、それに頼らない。
  - 認可: スクリーンショット・プロキシの取得は版の閲覧権限（`work.view`）を持つ本人のリクエストに限り、`GET /files/:artifactId` と同じ `private, no-store` で配信（A-11）。プロキシの URL に認可なしでアクセスできないよう、短命の署名付きパラメータでなく Bearer を要求（iframe なので Cookie か専用の短命トークン。D3 の方針に合わせる）。
  - 秘密: Figma のトークン／OAuth クライアントシークレット、Browser Rendering の資格情報、ステージングの Basic 認証は `wrangler secret`（既存の `MF100_UPLOAD_SECRET` と同じ扱い）。ブラウザへ渡さない。チャットで鍵を受け取らない。
  - Figma への書き戻し・外部サイトへのアクセスは「外部への実データ送信」なので、既定は無効（`FigmaPolicy.writeBack=false`、`WebProofPolicy.allowedHosts=[]`）。`restricted` な制作物は AI 校正と同様に既定で外部送信しない。
- **プライバシー**: スクリーンショットにはサイトの個人情報が写り得る。版の添付と同じ保持・削除規程（D14）に従う。ライブ表示のコメントで取る `textQuote` は 200 文字（`TEXT_QUOTE_MAX`）に切る。
- **性能**: スクリーンショットは提出確定の非同期ジョブ（版の `verified` は撮影完了を待たず、撮影は「補助添付」として後から付く／撮影失敗でも版は成立。方針は §8 Q4）。Figma の画像取得は 1 版 1 リクエスト。R2 保存は既存の試行キー方式（`receiveUpload` と同じ補償）。ライブ表示の iframe は端末切替で再読込しない（サイズだけ変える）。
- **アクセシビリティ**: 端末切替はセグメントボタン／メニュー（M3E）でキーボード操作可。iframe には `title`（「ライブ表示: <サイト名>（iPhone 17、402×874）」）。印の読み上げは PDF と同じ。コメントモードの切替はトグル（`aria-pressed`）。ブリッジのハイライトは色だけでなく枠線＋ラベル。
- **保守性**: 業務ルール（版の不変、位置の妥当性、再アンカーの判定）は `packages/domain`、取得・書き換え・撮影は `apps/api`（Hono）のアダプタ、Convex 関数は保存と ACL のみ（CLAUDE.md の依存の向き）。

## 5. 承認が必要な事項

| #   | 事項                                                                                                                                                  | 誰が／何を            | 承認前の動き                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **委員会の Figma プランとシート**（Starter か Professional 以上か、トークン所有者が Full/Dev シートか）。Starter なら FG-05 は月 6〜20 回しか動かない | 利用者・委員会        | **承認済み（2026-10-17: Education プラン＝Professional 相当。「API が使えるならまずはそっちで試す」）**。FG-05 を実装。トークンは利用者が `wrangler secret put FIGMA_ACCESS_TOKEN` で置く |
| 2   | **Figma OAuth アプリの登録**（名称・リダイレクト URI・許可する埋め込みオリジン）。PAT は 90 日で切れるので OAuth を推奨                               | 委員会の Figma 管理者 | まずは PAT（90 日で更新）。OAuth は後続。`FIGMA_ACCESS_TOKEN` が無ければ `/figma/status` が無効を返し UI は取り込みを出さない（AI 校正と同じ `status` パターン）                          |
| 3   | Figma へのコメント書き戻し（外部への実データ送信）                                                                                                    | 利用者                | 既定無効のポリシー値                                                                                                                                                                      |
| 4   | **Cloudflare Workers Paid への切替**（$5/月＋Browser Rendering 超過 $0.09/時）。無料枠は 10 分/日・同時 3 で試験運用の撮影には足りない可能性          | 利用者（課金）        | 制作者がスクリーンショットを手動添付                                                                                                                                                      |
| 5   | プロキシの**許可リスト**（ホスト名）と**専用オリジン**（DNS 設定）。外部サイトのプロキシ表示は利用規約上の確認も                                      | 利用者・委員会        | スニペット方式（委員会のサイト）のみ                                                                                                                                                      |
| 6   | 委員会のサイト（公式サイト・ステージング）への**ブリッジスニペット設置と `Content-Security-Policy: frame-ancestors <アプリのオリジン>`**              | Web 担当              | デモの見本サイトで実装・検証                                                                                                                                                              |
| 7   | ステージングの Basic 認証などの資格情報を Worker の秘密として持つか                                                                                   | 利用者                | 持たない（公開 URL のみ撮影）                                                                                                                                                             |
| 8   | スクリーンショット・Figma 書き出し画像の保持期間（D14 と同じか）                                                                                      | 制度担当              | 版の添付と同じ                                                                                                                                                                            |

## 6. 提案する設計

### 6.1 データモデル

**Artifact の拡張**（`packages/domain/src/revision/Artifact.ts`）

```ts
// 添付の由来（画像・PDF がどこから来たか。校正の座標は従来どおり画像基準）
export type ArtifactOrigin =
  | {
      kind: "figma";
      fileKey: string;
      nodeId: string;
      nodeName?: string;
      figmaVersion?: string;
      lastModified?: string;
      scale: number;
      // 画像の 0..1 を Figma のフレーム座標に戻すための大きさ（absoluteBoundingBox）
      box: { width: number; height: number };
    }
  | {
      kind: "web_snapshot";
      url: string;
      deviceId?: string;
      viewport: {
        width: number;
        height: number;
        dpr: number;
        orientation: "portrait" | "landscape";
      };
      userAgent?: string;
      fullPage: boolean;
      capturedAt: Instant;
    };

export interface Artifact {
  /* 既存 */ origin?: ArtifactOrigin;
}
```

- Figma の版: `type: "image"`（または `pdf`）の添付＋`origin.kind="figma"`。**コメントは既存の `image_rect`/`image_pin`/`pdf_*` のまま**。新アンカー型は不要（Figma の `FrameOffset` へは `node_offset = {x: rect.x * box.width, y: rect.y * box.height}` で変換できる）。
- Web の版: `type: "image"` の添付（端末ごと）＋`origin.kind="web_snapshot"`。コメントは `image_rect`/`image_pin`。
- `pickReviewArtifact` の順は PDF → 画像 → 文章 → 動画のまま。`prefer` に制作物の媒体（`web`/`figma`）が来たときは画像を先に選ぶ。
- ライブ表示用に Revision（または添付 `role:"external"`）に `liveUrl`（複数可）を持つ。既存の `externalUrl` を使う。

**新アンカー `web_element`**（`packages/domain/src/comment/Anchor.ts` の union に追加）

```ts
| {
    type: "web_element";
    artifactId: ArtifactId;            // role:"external" の URL 添付（ライブ表示の対象）
    url: string;                       // パス＋クエリ（オリジンは添付の URL）
    selector: {
      css: string;                     // 一意になるよう生成（id → data-* → nth-of-type の経路）
      xpath?: string;
      textQuote?: { exact: string; prefix?: string; suffix?: string }; // 文字範囲のとき必須
      tag: string;
    };
    rect?: NormalizedRect;             // 要素の境界ボックス内の 0..1（矩形）
    point?: NormalizedPoint;           // 要素内の 0..1（ピン）。rect と排他
    textRange?: { start: number; end: number }; // 要素の textContent 内のオフセット（任意）
    viewport: { width: number; height: number; dpr: number; deviceId?: string; orientation: "portrait" | "landscape" };
    fallback: { pageX: number; pageY: number; scrollY: number }; // 文書座標（px）。再アンカー失敗時
    snapshotArtifactId?: ArtifactId;   // WB-06 の切り抜き
  }
```

- `validateAnchor`: `css` 非空・1000 文字以内、`rect`/`point` 排他、`viewport.width` 1〜10000、`textQuote.exact` は `TEXT_QUOTE_MAX` 以内。
- 再アンカーの判定（表示時に計算、保存しない）: `attached`（セレクタ一致）／`moved`（引用文で一致）／`detached`（座標だけ）。domain に純粋関数 `resolveWebAnchor(candidates, anchor)` を置き、ブリッジは候補の矩形と文字列を返すだけにする。
- 「別の端末幅で付けたコメント」は `viewport` を比較して表示する（Atarim の方式）。

**ポリシー値**（domain、環境変数から読む。AI 校正の `aiConfig()` と同型）

```ts
export interface FigmaPolicy {
  enabled: boolean;
  writeBack: boolean;
  allowRestricted: boolean;
  renderScale: 1 | 2;
}
export interface WebProofPolicy {
  snapshotEnabled: boolean;
  allowedProxyHosts: readonly string[];
  defaultDevices: readonly string[] /* 例 ["iphone-17", "pc-1440"] */;
  allowRestricted: boolean;
}
```

### 6.2 API（Hono、`apps/api/src/app.ts` に追加。業務ルールは置かない）

| 経路                                   | 役割                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /figma/renders`                  | 認可（版の提出者）後、Convex から版と Figma URL を受け取り、`GET /v1/files/:key/nodes` → `GET /v1/images/:key?ids=..&scale=2&format=png` → 画像を R2 の試行キーへ保存 → Convex の `/internal/uploads` と同じ採用手順で添付化（`origin.kind="figma"`）。429 は `Retry-After` で 1 回だけ再試行、失敗は `failed` と理由 |
| `POST /web/snapshots`                  | 版の URL × 端末プリセットで Browser Rendering（Workers Binding。`page.emulate({viewport, userAgent, deviceScaleFactor, isMobile})`、`fullPage`、`waitUntil: networkidle0`、タイムアウト 30s）→ R2 → 添付化（`origin.kind="web_snapshot"`）。REST `/screenshot` で代替可                                               |
| `POST /web/clips`                      | WB-06。`clip` 付き撮影で要素の切り抜き                                                                                                                                                                                                                                                                                |
| `GET /web-proxy/*`（**専用オリジン**） | WB-08。許可リスト検査 → 取得 → HTML 書き換え（`<base href>`、相対→絶対、`X-Frame-Options`/`Content-Security-Policy`/`Set-Cookie` 除去、`<script src="/bridge.js">` 注入）→ 配信。CSS/JS/画像は書き換えずに中継（CORS 用に `Access-Control-Allow-Origin` を専用オリジンへ）                                            |
| `GET /bridge.js`                       | 委員会のサイトにも置けるブリッジ本体（同じコード）。`postMessage` で `ready`／`hit`（候補の要素: css・xpath・text・rect）／`scroll`／`navigate`（URL 変化）を親へ、親から `mode`（閲覧／コメント）・`highlight`（既存コメントの再アンカー要求）・`scrollTo`                                                           |

Convex 側は `artifacts`/`comments` の保存と ACL のみ（`anchorValidator` に `web_element` を追加、`artifacts` に `origin` を追加 → `pnpm codegen`）。

### 6.3 画面（M3E の部品で）

- **紙面（`features/annotation/`）**: `FigmaFrameViewer` は不要（`ImageViewer`/`PdfViewer` に由来情報のチップ「Figma: <ノード名>」と「Figma で開く」のリンクを足すだけ）。`WebLiveViewer` を新設: 上に **端末のセグメントボタン／メニュー（既存 `DevicePicker` を共用）・回転のアイコンボタン・幅の入力・「閲覧／コメント」のトグル**、中央に `PostPreview` と同じベゼル付きの枠（`zoom` で縮小）、中に iframe。ブリッジ未応答なら枠の中に M3E のカードで「埋め込みを拒否しています／スナップショットで校正してください」。
- **紙面の切替**（既存の添付切替に統合）: 「スナップショット（iPhone 17）」「スナップショット（PC）」「ライブ」「Figma 埋め込み」をチップ／タブで。ライブと埋め込みには **バナー**「今の内容を表示しています。この版の内容はスナップショットです」（CM-03）。
- **コメントのカード**: `web_element` は「iPhone 17（402px）・/events/ の `h2.title`」と再アンカー状態のチップ（attached は出さない、moved は tertiary、detached は error の文言「位置が外れました」）。Figma 由来は「Figma で開く」のテキストボタン。
- **提出ダイアログ（`features/upload/SubmitDialog`）**: 「Figma の URL」「サイトの URL（複数）」の入力、「提出確定時にスクリーンショットを撮る端末」のチェック（既定はポリシー値）。承認前は「書き出した画像を添付してください」の案内。
- **管理（U-08）**: Figma 連携の状態（有効／無効／理由）、スクリーンショットの状態、プロキシ許可リスト（読み取り表示。変更は環境変数＝承認制）。

### 6.4 デモモード

- `apps/web/public/demo-site/`（または `src/demo/site/`）に見本の静的サイト（レスポンシブ、ブリッジを `<script>` で読み込む）を置き、Vite／Pages から同一オリジンで配信 → iframe＋`postMessage` がネットワーク無しで動く。
- Figma・スクリーンショットの見本は固定 PNG と `origin` メタの seed（`apps/convex/convex/seed.ts`）。`POST /figma/renders` 等はデモでは「承認前のため無効」の状態を返す。

## 7. MVP の範囲と段階的な実装計画

| 段階                                      | 内容                                                                                                                                                                                                                                                                                                                                      | 外部依存・承認                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Phase 0（今すぐ可）**                   | `Artifact.origin`（figma / web_snapshot）、提出時の Figma URL・サイト URL 入力、由来チップ・Figma ディープリンク、フレーム一覧、版比較の既定ペア、`WebLiveViewer`（端末プリセット・回転・縮小・閲覧モードのみ）、埋め込み拒否の検知と案内、見本サイトでのデモ、CM-03 のバナー。制作者が書き出し画像／スクリーンショットを手動添付して校正 | なし                                                           |
| **Phase 1（スニペット方式のライブ校正）** | `bridge.js`、`web_element` アンカー、コメントモード、再アンカー（attached/moved/detached）、端末幅の記録と表示、文字範囲                                                                                                                                                                                                                  | 委員会サイトへのスニペットと frame-ancestors の設置（承認 #6） |
| **Phase 2（自動化）**                     | `POST /web/snapshots`（提出確定時の撮影）、`POST /figma/renders`、WB-06 の切り抜き、FG-06 の版比較                                                                                                                                                                                                                                        | Workers Paid（#4）、Figma OAuth アプリとプラン確認（#1, #2）   |
| **Phase 3（後続）**                       | プロキシ表示（許可リスト・専用オリジン）、Figma 埋め込み表示、Figma コメントの読み取り表示・書き戻し、Webhook での Figma 更新通知、ステージング資格情報                                                                                                                                                                                   | #3, #5, #7                                                     |

MVP＝Phase 0＋Phase 1。これで「校正システム内で表示し、位置を合わせてコメントする（レスポンシブ・端末対応）」が、委員会のサイトについては実際に動き、Figma は書き出し画像で成立する。Phase 2 は承認が揃った順に足す。

## 8. 未決事項（質問は少なく、推奨の既定値つき）

| #   | 質問                                                                                                 | 推奨の既定                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Q1  | 委員会の Figma は Starter か Professional 以上か。API 用トークンは誰のシートで発行するか             | 確認まで **手動書き出し**で進める。Professional 以上・Full/Dev シートなら Phase 2 で自動取り込み |
| Q2  | 校正対象の Web サイトは委員会が管理するもの（スニペットを置ける）が中心か、外部制作のサイトもあるか  | **委員会のサイト中心**と仮定し、スニペット方式を先に。外部はスナップショットのみ                 |
| Q3  | Workers Paid（$5/月＋従量）に切り替えてよいか。閑散期（6〜10 月、O1）は止めるか                      | 繁忙期だけ有効にし、承認まで手動添付                                                             |
| Q4  | スクリーンショットの撮影が失敗したとき、版の提出確定を止めるか、版は成立させて撮影だけ再試行にするか | **版は成立、撮影は補助添付として再試行**（旧版の受付終了の原子性 D1 を撮影に依存させない）       |
| Q5  | 既定の端末は何種か                                                                                   | スマホ 1 種（iPhone 17、402×874）＋PC 1 種（1440 幅）。SNS プレビューの既定端末に揃える          |
| Q6  | ライブ表示で別の端末幅のコメントの印を出すか、その幅のコメントだけにするか                           | **全部出し、元の幅をカードに表示**（Atarim 方式）。フィルタで絞れる                              |

## 9. 既存コードへの接点（実装者向けメモ）

- `packages/domain/src/comment/Anchor.ts`: union に `web_element` 追加、`validateAnchor` の分岐、`resolveWebAnchor`（純粋関数）。`__tests__/anchor.test.ts` に追加。
- `packages/domain/src/revision/Artifact.ts`: `ArtifactOrigin`、`pickReviewArtifact` の `prefer` 対応。
- `packages/application/src/usecases/comments.ts`・`feedback.ts`: `anchor_artifact_mismatch` の判定に `web_element`（`role:"external"` の URL 添付を許す）を追加。
- `apps/convex/convex/schema.ts`: `anchorValidator`・`artifacts.origin`。`pnpm codegen`。
- `apps/api/src/app.ts`・`ports.ts`・`adapters/`: 上記ルートとアダプタ（`FigmaClient`、`ScreenshotService`、`HtmlRewriter`）。`wrangler.jsonc` に `browser` バインディングと専用オリジンのルート。秘密は `wrangler secret`。
- `apps/web/src/features/annotation/`: `WebLiveViewer.tsx`、`ImageViewer` への由来チップ。`features/social/preview/devices.ts` にタブレット・PC 幅を追加して共用。
- `apps/web/src/demo/`・`public/demo-site/`: 見本サイトと seed。
- 文書: `docs/REQUIREMENTS.md` の C5・F-10・§3.2 後続（「Web DOM に追随する注釈」「Figma 同期」）を本提案で更新、`docs/DECISIONS.md` に「Figma・Web の校正（本体で）」の行、`docs/UI_M3E.md` に §54。

## 10. 実装の状態（2026-10-17）

| 項目                                                                                                                                                                 | 状態                                                                               | 場所                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `web_element`・`figma_node` アンカー、`validateAnchor`、`anchorFitsArtifact`、`webElementAnchor`                                                                     | 実装                                                                               | `packages/domain/src/comment/Anchor.ts`                                                                         |
| 再アンカー `resolveWebAnchor`（attached / moved / detached）、`placeIn`・`relativeTo`・`toViewportUnit`、場所の表示、`WebProofPolicy`                                | 実装                                                                               | `packages/domain/src/web/webProof.ts`                                                                           |
| Figma の URL の解釈（design / file / proto / ブランチ、node-id 1-2 → 1:2）、ディープリンク、Embed Kit 2.0 の URL、`FigmaPolicy`                                      | 実装                                                                               | `packages/domain/src/web/figma.ts`                                                                              |
| `Artifact.origin`（figma / web_snapshot）、取り込み項目の由来とノード名の反映（`markItemVerified`）                                                                  | 実装                                                                               | `packages/domain/src/revision/Artifact.ts`・`UploadSession.ts`、Convex `artifacts.origin`・`uploadItems.origin` |
| コメント・FB のアンカーと添付の種類の検査                                                                                                                            | 実装                                                                               | `packages/application/src/usecases/comments.ts`・`feedback.ts`                                                  |
| Hono `GET /figma/status`・`POST /figma/import`（nodes → images → 取得 → 試行 → R2 → 採用。429 は Retry-After を 1 回）                                               | 実装（偽のクライアントで試験。本物の API はこの環境から呼んでいない）              | `apps/api/src/figmaImport.ts`・`adapters/figmaClient.ts`                                                        |
| ブリッジ（スニペット）と見本サイト                                                                                                                                   | 実装                                                                               | `apps/web/public/bridge.js`・`public/demo-site/`                                                                |
| `WebLiveViewer`（端末・回転・幅・閲覧／コメント・印・埋め込み拒否の案内・CM-03 のバナー・WB-12 の注記）                                                              | 実装                                                                               | `apps/web/src/features/annotation/WebLiveViewer.tsx`・`webBridge.ts`                                            |
| `FigmaEmbedViewer`（埋め込み・フレームの切り替え・「このフレームにコメント」・「Figma で開く」）                                                                     | 実装                                                                               | `apps/web/src/features/annotation/FigmaEmbedViewer.tsx`                                                         |
| 提出ダイアログの「Figma のフレーム」（URL → 取り込み。連携が無ければ外部リンクだけ）                                                                                 | 実装                                                                               | `apps/web/src/features/upload/SubmitDialog.tsx`・`submissionFlow.ts`                                            |
| カード: 付けたときの端末幅、「位置が外れました」、「Figma で開く」                                                                                                   | 実装                                                                               | `apps/web/src/features/review/ThreadCard.tsx`                                                                   |
| WB-01 提出確定時のスクリーンショット（Browser Rendering）、WB-06 切り抜き、WB-08 プロキシ、FG-06 版比較の既定ペア、FG-08 Figma コメントの読み取り・書き戻し、Webhook | 未実装（承認待ち。ポリシー値は既定で無効）                                         | —                                                                                                               |
| 通知から開いたときに端末幅・要素へ移る（CM-06）                                                                                                                      | 一部（カードを押すと端末を合わせて要素へ。通知からは開いたコメントが選ばれるまで） | —                                                                                                               |

### 10.1 サイトへのブリッジの設置（Web 担当向け）

1. サイトの `<head>` か `</body>` の前に 1 行:
   ```html
   <script
     src="https://<校正システムのオリジン>/bridge.js"
     data-allow-origin="https://<校正システムのオリジン>"
     defer
   ></script>
   ```
   `data-allow-origin` は校正システムのオリジン（複数なら空白区切り）。省くとサイトと同じオリジンの親にだけ応える。校正システムの外で開いたページでは何もしない。
2. 応答ヘッダーに `Content-Security-Policy: frame-ancestors 'self' https://<校正システムのオリジン>` を付ける（`X-Frame-Options: DENY / SAMEORIGIN` は外す。両方あると CSP が優先される）。ステージングに Basic 認証があると iframe の中でも求められる（Safari は第三者 Cookie を遮るので、ログインの要るステージングは崩れることがある）。
3. ブリッジがやり取りするのは postMessage だけで、送るのは押した要素のセレクタ・タグ・短い引用文（200 文字まで）・矩形・URL のパス。フォームの値・Cookie は送らない。許していないオリジンからのメッセージは無視する。
4. 校正システム側: 版の提出で「外部リンク」にサイトの URL（https）を入れる。校正画面でその添付を開くとライブ表示になり、ブリッジが応えると「閲覧／コメント」が使える。応えない（埋め込み拒否・未設置）ときは理由と「新しいタブで開く」が出る。

### 10.2 Figma の取り込みの設定（利用者の手順）

1. Figma の設定 › Security › Personal access tokens でトークンを作る（スコープ `file_content:read`、期限は最長 90 日。切れたら作り直して置き替える）。
2. `cd apps/api && wrangler secret put FIGMA_ACCESS_TOKEN`（ローカルは `.dev.vars`）。ブラウザ・Convex には渡らない。
3. 提出ダイアログの「Figma のフレーム」に、Figma でフレームを選んで「リンクをコピー」した URL（`…?node-id=1-2`）を 1 行ずつ貼る。提出時に 1 ファイル 1 回の `nodes` と `images` で PNG（scale 2）を書き出し、画像の添付（ファイル名はノード名）になる。URL は外部リンクとしても残り、埋め込み表示とフレーム単位のコメント、「Figma で開く」に使う。
4. レート制限（429）は 1 回だけ待って再試行し、それでも失敗したら項目が「失敗」になるので「再取り込み」を押す。トークンに権限が無い・ファイルが見つからないときは理由が出る。
