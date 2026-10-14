# Material 3 Expressive 適用（UI 再構築）

実施: 2026-10-13。対象は `apps/web` のみ。PDF 表示・注釈座標・認証・業務ロジック（domain / application / convex / api）には変更を加えていない。

## 1. 調査で指摘された P0: テーマの適用範囲

### 事実確認（Computed Style）

`@m3e/web@2.9.2` の `m3e-theme` は、**`<body>` の直下にあるときだけ** テーマ変数を `html` に、フォントと背景色を `body` に適用する。それ以外の位置では自身の shadow root に `:host { … }` として閉じる（`theme.js` の `replaceSync` 分岐）。v0/v1 では React の `#root` の内側に `<M3eTheme>` を置いていたため、`:root` で定義した `--mf-*` の `var(--md-sys-color-*, fallback)` は **常にフォールバック値**に落ちていた。

| 計測点                                        | 改修前                       | 改修後（ライト）                              | 改修後（ダーク） |
| --------------------------------------------- | ---------------------------- | --------------------------------------------- | ---------------- |
| `m3e-theme` の親要素                          | `DIV`（#root 内）            | `BODY`                                        | `BODY`           |
| `html` の `--md-sys-color-primary`            | （未定義）                   | `#2b5ea8`                                     | `#bcd2ff`        |
| `.shell` の `--mf-primary`（独自 CSS が参照） | `#005cbb`（フォールバック）  | `#2b5ea8`                                     | `#bcd2ff`        |
| `body` の背景                                 | `rgb(247,249,251)`（固定値） | `rgb(249,249,255)` = `--md-sys-color-surface` | `rgb(7,14,27)`   |
| `body` のフォント                             | Noto Sans JP                 | Noto Sans JP                                  | Noto Sans JP     |

計測はデモモードで Playwright から `getComputedStyle` を取得した（`apps/web/e2e/screenshots.mjs` と同じ経路）。

### 修正

- `apps/web/index.html`: `<m3e-theme color="#1b5fb4" variant="expressive" scheme="auto" motion="expressive" strong-focus>` を `<body>` 直下に置き、その中に `#root`。設定値は `src/theme.ts` に集約（`<M3eTheme>` は `__root.tsx` から削除）。
- `src/styles.css`: 独自変数 `--mf-*` はすべて `--md-sys-color-*` の別名にし、M3 の色役割（surface-container 階層、primary/secondary/tertiary container、error、inverse）を揃えた。`scheme="auto"` によりダークモードは自動（画面 #20）。
- M3 に無い「成功」「注意」は固定の補助色（ライト／ダーク別）にした。動的カラーの tertiary/secondary は seed 次第で緑になるため、「未完了」を tertiary で塗ると意味が崩れる（実際にそうなったので修正）。重大（critical）だけは M3 の error を使う。

## 2. フォーム共通部品の再設計（P0）

`src/ui/Field.tsx` を M3E ベースに置き換えた。入力そのものは native を維持する（日本語 IME・キーボード操作・ブラウザ標準の検証を優先）。

| 部品                      | 実装                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Field`                   | `m3e-form-field`（outlined, float-label=always）。label / hint / error を slot に置き、`useId` で生成した id を子の入力と `label[for]` / `aria-labelledby` に配線 |
| `TextInput` / `TextArea`  | native `input` / `textarea`（form-field の既定 slot）                                                                                                             |
| `Select`                  | `m3e-select` + `m3e-option`。`<option>` 子要素をそのまま受け取り写すので呼び出し側は無変更                                                                        |
| `Checkbox`                | `m3e-checkbox` + label（`aria-labelledby`）                                                                                                                       |
| 検索                      | `m3e-search-bar`（制作物一覧・管理のユーザー検索）                                                                                                                |
| ユーザー選択 `UserPicker` | 選択済みは `m3e-input-chip`（removable）、検索欄は form-field、候補は listbox                                                                                     |

この差し替えだけで、登録・編集・提出・サインイン・ACL・指摘投稿の全フォームが Material の外観になった。

## 3. 共通 UI の体系化（P1）

| 領域               | 変更                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文字               | M3 タイプスケール（body-medium を基本、label-large / title-medium / headline-small）を `--mf-type-*` に定義。見出しは `m3e-heading`（`PageHeader` / `Card` 経由）                                     |
| 形・動き           | シェイプスケール（4/8/12/16/28px）と standard easing を変数化                                                                                                                                         |
| カード             | `Card`（`m3e-card` filled/outlined/elevated + title-medium 見出し）。制作物詳細・管理・ACL・サインイン・専門確認・持越・外部媒体で使用                                                                |
| 状態チップ         | `StatusChip`（tone: neutral/primary/success/warning/error, アイコン任意）。ライフサイクル・受付状態・重大度・採否・割当・権限の色を一箇所で固定                                                       |
| 一覧               | テーブルは独自実装を維持（密度優先）。ヘッダーを label-large、角丸コンテナ、ホバーの state layer、**期限超過行は error コンテナ、完了・校了行は沈める**。スクロール領域は tabIndex でキーボード到達可 |
| 通知               | `m3e-action-list` / `m3e-list-action`（leading icon / overline / supporting text / trailing）                                                                                                         |
| ナビ               | `m3e-nav-rail`（600 以上。メニュー＋FAB＋行き先。1200 以上は標準展開、840–1199 はモーダル展開）、599 以下は `m3e-nav-bar`（下部固定、通知を含む 3 件）。未読数は `m3e-badge`（§12）                   |
| 版提出             | `m3e-stepper`（内容とファイル → 転送と検証 → 提出確定）、`m3e-linear-progress-indicator`、ファイル選択はドロップ風コンテナ                                                                            |
| 案内               | `.alert` に色役割（info=primary container / warn=補助の注意色 / error）とアイコン                                                                                                                     |
| 校正ワークスペース | 指摘カードは左の色帯（critical=error, major=注意色）＋チップで重大度、解決済みは濃淡を落として沈める。専門確認・持越・外部媒体は `Card`                                                               |

## 4. 使用コンポーネント（改修後、JSX 出現数）

| `M3eIcon` | 73 |
| `M3eButton` | 60 |
| `M3eIconButton` | 8 |
| `M3eFilterChip` | 6 |
| `M3eDialog` | 4 |
| `M3eHeading` | 3 |
| `M3eFilterChipSet` | 3 |
| `M3eStep` | 3 |
| `M3eFormField` | 2 |
| `M3eBadge` | 2 |
| `M3eSearchBar` | 2 |
| `M3eLinearProgressIndicator` | 2 |
| `M3eCard` | 1 |
| `M3eOption` | 1 |
| `M3eSelect` | 1 |
| `M3eCheckbox` | 1 |
| `M3eInputChip` | 1 |
| `M3eNavItem` | 1 |
| `M3eNavRail` | 1 |
| `M3eAppBar` | 1 |
| `M3eNavBar` | 1 |
| `M3eActionList` | 1 |
| `M3eListAction` | 1 |
| `M3eStepper` | 1 |

独自実装として残したもの:

| `<table` | 8 |
| `<input (native, form-field 内)` | 5 |
| `<select (native)` | 0 |
| `<textarea (native, form-field 内)` | 1 |

テーブル・PDF/画像ビューア・座標指定・文章ビューアは要件（情報密度・精密な位置指定）上、独自実装を維持し、色・形・文字・操作状態だけ M3 トークンを共有する。

## 5. 画面比較（改修前 → 改修後）

改修前は `docs/screenshots-before/`、改修後は `docs/screenshots/`（同じ Playwright 経路で撮影）。

| 画面                   | 改修前                                                         | 改修後                                                 |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| サインイン             | ![before](screenshots-before/01-signin.png)                    | ![after](screenshots/01-signin.png)                    |
| 制作物一覧             | ![before](screenshots-before/02-works-list.png)                | ![after](screenshots/02-works-list.png)                |
| 制作物詳細（版なし）   | ![before](screenshots-before/03-work-detail-empty.png)         | ![after](screenshots/03-work-detail-empty.png)         |
| 版提出（専門確認）     | ![before](screenshots-before/14-submit-required-checks.png)    | ![after](screenshots/14-submit-required-checks.png)    |
| 版提出（検証済み）     | ![before](screenshots-before/04-submit-verified.png)           | ![after](screenshots/04-submit-verified.png)           |
| 提出確定               | ![before](screenshots-before/05-submit-confirmed.png)          | ![after](screenshots/05-submit-confirmed.png)          |
| 制作物詳細（割当後）   | ![before](screenshots-before/06-work-detail-with-revision.png) | ![after](screenshots/06-work-detail-with-revision.png) |
| 制作物の編集           | ![before](screenshots-before/15-work-edit.png)                 | ![after](screenshots/15-work-edit.png)                 |
| 校正待ち               | ![before](screenshots-before/07-queue.png)                     | ![after](screenshots/07-queue.png)                     |
| 校正ワークスペース     | ![before](screenshots-before/08-workspace-comment.png)         | ![after](screenshots/08-workspace-comment.png)         |
| 専門確認の完了         | ![before](screenshots-before/16-required-check-done.png)       | ![after](screenshots/16-required-check-done.png)       |
| 文章の範囲指摘         | ![before](screenshots-before/19-text-range.png)                | ![after](screenshots/19-text-range.png)                |
| 採否                   | ![before](screenshots-before/09-decision.png)                  | ![after](screenshots/09-decision.png)                  |
| 持越                   | ![before](screenshots-before/17-carry-forward.png)             | ![after](screenshots/17-carry-forward.png)             |
| 校了ダイアログ         | ![before](screenshots-before/10-finalize-dialog.png)           | ![after](screenshots/10-finalize-dialog.png)           |
| 校了後                 | ![before](screenshots-before/11-work-finalized.png)            | ![after](screenshots/11-work-finalized.png)            |
| 通知                   | ![before](screenshots-before/18-notifications.png)             | ![after](screenshots/18-notifications.png)             |
| 閲覧権限               | ![before](screenshots-before/12-acl.png)                       | ![after](screenshots/12-acl.png)                       |
| 管理                   | ![before](screenshots-before/13-admin-audit.png)               | ![after](screenshots/13-admin-audit.png)               |
| ダークモード（自動）   | —                                                              | ![after](screenshots/20-dark-workspace.png)            |
| モバイル幅（下部ナビ） | —                                                              | ![after](screenshots/21-mobile-queue.png)              |

## 6. 検証

- `vp check` 0 エラー 0 警告、全パッケージ typecheck、`vp test` 16 ファイル 124 件、本番ビルド・デモビルド成功。
- `pnpm a11y`（axe-core, WCAG 2.1 A/AA）: 21 画面で違反 0。改修直後に出た `aria-input-field-name`（m3e-select）、`aria-toggle-field-name`（m3e-checkbox）、`aria-required-parent`（input chip）、`aria-required-children`（list に button）、`scrollable-region-focusable` を修正済み。
- 画面撮影の経路（`e2e/screenshots.mjs`）は m3e-select / m3e-checkbox 用に更新した（`select[aria-label]` → `m3e-select` の value 設定）。

## 7. 残り

- `@m3e` の date picker / time picker は未採用（期限入力は native `datetime-local`）。
- 版提出の stepper は表示のみ（手順の移動は従来どおり画面状態で制御）。
- キーボードのみ操作・スクリーンリーダーの実機確認（A-15）は未実施。

## 8. 2 回目の見直し（2026-10-13・利用者フィードバック）

指摘: 「date/time picker も使いたい」「情報量が多すぎる」「背景色とチップを使いすぎ」。類似ツール（GitHub のレビュー、Linear、Figma / Frame.io のコメント）に共通する作法に合わせた。

### 日付（締切・納期）

- 時刻は常に 0:00 JST とし、**日付だけ**を選ぶ `DateField`（`m3e-date-input type="date"` + `m3e-datepicker`）に置き換えた（画面 #22）。値はその暦日の 0:00 JST の epoch ms。表示も日付のみ（`formatJstDate`）。
- 校正期限の最短は翌日（当日 0:00 は過去になるため）。
- time picker（`m3e-timepicker`）は用意したが、時刻を持たない方針のため未使用。

### 情報量の削減

| 画面            | 削ったもの                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 校正待ち        | 7 列 → 4 列（制作物＋版、締切、状態、指摘件数）。用途・観点はワークスペースで見る                                                                               |
| 制作物一覧      | 7 列 → 4 列。旧ID・区分・媒体は名称の下に小さく。状態フィルターは 進行中／保留／校了 の 3 つ                                                                    |
| 制作物詳細      | 編集・閲覧権限・保留／中止はオーバーフローメニュー（`m3e-menu`）へ。基本情報は 4 行、校了履歴は実績があるときだけ。版履歴は 8 列 → 5 列（変更点・観点は非表示） |
| 登録・編集      | 旧ID・機密区分は「詳細設定」に折りたたみ。長い補足文は削除                                                                                                      |
| 版提出          | 校正の種類を削除（既定値）。専門確認・外部リンクは折りたたみ。注意文は 1 行                                                                                     |
| ワークスペース  | 校正対象者の列挙 → 人数のみ（詳細はツールチップ）。重大度フィルター削除。種別「修正提案」は非表示                                                               |
| 通知・管理・ACL | 説明文を削除。列を半分に                                                                                                                                        |

### 塗りとチップの削減（作法）

- **色付きチップは「操作を左右する状態」1 つだけ**（受付中／受付終了、未確認／確認完了、進行中／校了、転送状態）。それ以外（版、種別、件数、担当、ファイル名、持越）は文字（`.meta`）。
- 重大度・採否は文字色だけで表す（重大 = error、重要・未対応 = 注意色、反映済 = success）。指摘カードの左の色帯と合わせて 2 つ以上の塗りを重ねない。
- カードは outlined を既定にし、filled は使わない。テーブルのヘッダー塗り・外枠を外し、区切り線のみ。通知・専門確認・アップロード項目は行区切りのリスト。案内（info）は塗らずアイコン＋文字。
- サインイン背景のグラデーション、ビューアの濃い塗りを除去。

### 検証

- 22 画面で axe 違反は **M3E の calendar 内部（過去日のセルに accessible name が無い）だけ**（`aria-command-name` ×5）。アプリ側から名前を付けられない library 由来の問題なので、ライブラリ更新で解消を待つ（`docs/a11y-report.json`）。
- 画面比較: 1 回目の M3E 適用直後の画面は `docs/screenshots-before/` には含まれない（v1 の画面と今回の画面を比較する表は §5）。

## 8. 2 回目の見直し（2026-10-13・利用者フィードバック）

指摘: 「date picker も使いたい」「情報量が多すぎる」「背景色とチップを使いすぎ」「コメントの投稿者は分類しない（Google ドライブと同じ）」「JST 表記は当たり前なので消す」。GitHub のレビュー、Linear、Google ドライブ／Figma のコメント UI に共通する作法に合わせた。

### 日付

- 締切・納期は**日付だけ**（`DateField` = `m3e-date-input type="date"` + `m3e-datepicker`、画面 #22）。値はその暦日の 0:00 JST の epoch ms。表示は日付のみで「JST」は書かない。校正期限の最短は翌日。
- `m3e-timepicker` は用意したが未使用（時刻を持たない方針）。

### コメント

- 投稿欄は本文（＋任意の位置）だけ。種別・重大度の選択は無し。内部では種別「修正提案」・重大度「重要」で保存するため、**未解決のコメントが残ると理由なしでは校了できない**（安全側）。「重大」の明示や重大度の変更 UI は後続（D6）。
- 採否は「反映済／不採用／次版へ持越」の 3 つ。「確認済」「採用」の中間状態は UI から外した（ドメインには残る）。
- カードには番号・状態・投稿者・日時・本文だけ。種別は「合意事項」のときだけ、重大度は critical のときだけ表示。

### 情報量

| 画面                        | 削ったもの                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 校正待ち                    | 7 列 → 4 列（制作物＋版、締切、状態、コメント数）                                                                                 |
| 制作物一覧                  | 7 列 → 4 列。区分・媒体は名称の下。フィルターは 進行中／保留／校了                                                                |
| 制作物詳細                  | 編集・閲覧権限・保留／中止はオーバーフローメニュー（`m3e-menu`）。基本情報 4 行。校了履歴は実績があるときだけ。版履歴 8 列 → 5 列 |
| 登録・編集                  | 旧ID・機密区分は「詳細設定」に折りたたみ。補足文は全削除                                                                          |
| 版提出                      | 校正の種類を削除。専門確認・外部リンクは折りたたみ                                                                                |
| ワークスペース              | 校正対象者・未対応件数・重大度フィルターを削除                                                                                    |
| 通知・管理・ACL・サインイン | 説明文を削除。列を半分に。アプリバーは氏名のみ                                                                                    |

### 塗りとチップ

- 色付きチップは「操作を左右する状態」1 つだけ（受付中／受付終了、未確認／確認完了、進行中／校了、転送状態）。属性（版、種別、件数、担当、ファイル名、持越）は文字。
- 未対応・反映済・重大は文字色だけ（注意色／success／error）。
- カードは outlined のみ。テーブルはヘッダー塗りと外枠を外し区切り線だけ。通知・専門確認・アップロード項目は行区切り。案内文は塗らない。サインインの背景グラデーションとビューアの濃い塗りを除去。

### 検証

- 22 画面で axe 違反は M3E の calendar 内部（過去日セルに accessible name が無い）の 1 件のみ（`aria-command-name`）。アプリ側から直せない library 由来。

## 9. 3 回目の見直し（2026-10-13・「Google と同じアカウント表示」「テーマ切替をやめる」「飾りを無くす」）

- **アカウント**: 右上を Google と同じアバター表示にし、アバターは利用者指定の **Humation**（`@humation/react` + `@humation/assets-humation-1`。メール or ID を seed に決定的に同じ絵を描く、約 700KB のアセットは初回表示時に遅延読み込み）。クリックで氏名・メール・サインアウトのメニュー（`m3e-menu`）。`m3e-app-bar` の slot 外に置いた子は描画されないため、メニュー本体はアプリバーの外に置き、`m3e-menu-trigger` の `for` で結ぶ。
- **テーマ固定**: `scheme="light"`。自動切替・ダークモードの撮影・ダーク用の補助色を廃止。
- **飾りの削除**: ボタンの先頭アイコン（主要操作の「＋」「送信」「位置指定」を除く）、案内文・空状態・カード見出しのアイコン、状態チップのアイコン、版提出のステッパー、タイトル横の件数バッジ、サインインのロゴ、指摘カードのホバー影、サインインの背景グラデーションを削除。残るアイコンはナビゲーション、検索、カレンダー、アカウント、ピン位置、ツールバーなど意味のあるものだけ。
- M3E が読まない書体トークン（`--md-sys-typescale-font` 等）を削除。
- **アイコンのアニメーション**: Material Symbols の可変軸（FILL / wght）を CSS transition（350ms, standard easing）で連続的に変化させる。ナビの選択時は輪郭 → 塗り（FILL 0→1, wght 400→500）、ホバーで太さが増す。`prefers-reduced-motion` では無効。Playwright で遷移中の中間値（FILL 0.2 など）を確認済み。
- **アバターは Humation**: `src/ui/UserAvatar.tsx`。メニュー内の 2 つ目は装飾（`aria-hidden`）にして `role=img` が menu の子にならないようにした。

## 10. 4 回目の見直し（2026-10-13・比較ページからの「いいとこ取り」）

画面ごとに現状・M3E 準拠案・類似ツール（Google ドキュメント、Figma、Frame.io、Filestage）由来の案を並べた比較ページを作り、利用者が選んだ組み合わせを実装した。全体方針は「余白の美学。文字も機能も必要最低限」。

| 画面                 | 選択                                                                      | 実装                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| メニューとアカウント | 今のまま（左メニュー＋上のバー＋右上アカウント）。バーの題名は不要        | `_app.tsx`: アプリバーの title slot に `m3e-search-bar`（Google ドライブ式）。入力は制作物一覧の `?q=` に反映し、他画面からは一覧へ移動する。題名は消した                                                                                                                                                                                                                                                                                  |
| 一覧                 | 1 件 2 行のリスト ＋ 制作物は左一覧・右中身。スマホは Gmail 式            | 校正待ちは `m3e-action-list`（1 行目: 制作物と版、2 行目: 締切と指摘数、右端に状態の文字）。制作物は `works.tsx` をレイアウトルートにした list-detail（左 340px の一覧、右に子ルート）。960px 以下は一覧と中身を別画面に切り替え、中身には戻る矢印                                                                                                                                                                                         |
| 制作物の詳細         | 版を主役に、基本情報は右へ。校正する人が最新版へ迷わず行けること          | 最上部に最新（受付中）の版への大きなカード（`m3e-card actionable`、矢印付き）、その下に「これまでの版」のリスト。基本情報は右の補助パネル（1280px 以下では下に落ちる）。「校了を宣言」「理由付きで再開」「校了履歴」もパネル側。編集・閲覧権限・保留・中止は ⋮ メニュー                                                                                                                                                                    |
| 校正画面             | ピンの高さに並べる ＋ ピンだけ ＋ 下のフローティングツールバー            | ツールバーは `m3e-toolbar`（rounded, elevated）をビューア下端中央に浮かせ、ページ送り・倍率・回転・位置なしコメント・版比較・レイアウト切替を集約。レイアウトは 3 つ（横に一覧／ピンの高さに並べる／ピンだけ）を `localStorage` に保存。「並べる」は `AlignedGutter` が各カードを対応する位置の高さに置き、重なる分を押し出す（選択中は固定）。「ピンだけ」は選択中のコメントをピンの横の吹き出しに出す。パネルは閉じて PDF を全幅にできる |
| 範囲指定の投稿       | 何より範囲指定が楽になるように                                            | モード切替を廃止。投稿権限があれば常にドラッグ（範囲）・クリック（ピン）・文字列選択が有効で、確定した瞬間にその場へ投稿欄（`ComposePopover`）が出る。右に入らなければ左、左にも入らなければ下に置き範囲を隠さない。Ctrl/⌘+Enter で投稿、Esc で取消                                                                                                                                                                                        |
| コメントカード       | Google ドキュメント式（✓ と ⋮）。左端の色を無くし M3 カード。人のアイコン | `ThreadCard`: `m3e-card`（elevated）にアバター（Humation）・名前・日時・本文。操作は「✓ 解決（反映済）」と「⋮」（不採用（理由）／次版へ持越／担当者／訂正）だけ。開いているときだけ返信欄と履歴（返信はアバター付きの会話、採否は 1 行）。番号・状態の文字・重大度の色帯は廃止（重大のみ文字で残す）。解決済みは既定で隠し、「解決済み N」で表示                                                                                           |
| 版比較               | 版の比較の画面も見たい                                                    | ツールバーの「版を比較」から他の版を選ぶと、左に選んだ版・右に現在の版を並べる（ページ・倍率・回転を共有、倍率は自動で 70%）。比較中は投稿しない                                                                                                                                                                                                                                                                                           |
| 版の提出             | ダイアログ（スマホでは全画面）                                            | `SubmitDialog`（`m3e-dialog`）。制作物の画面から `?submit=1` で開き、ファイルはドロップか選択、確定後はその版の校正画面へ移る。720px 以下は全画面（`--m3e-dialog-*` を上書き）。`/works/:id/submit` ルートは廃止                                                                                                                                                                                                                           |
| スマホの校正画面     | コメントは下から引き出す                                                  | 960px 以下は `m3e-bottom-sheet`（detents: fit / half / full、初期は half）にコメント一覧を入れ、ツールバーはビューア上端に置く                                                                                                                                                                                                                                                                                                             |

### M3E 部品の追加

`m3e-toolbar`、`m3e-bottom-sheet`、`m3e-split-button`、`m3e-segmented-button`、`m3e-fab`、`m3e-button-group` を `ui/m3e.ts` に追加（使用は toolbar と bottom-sheet）。

### 実装上の知見

- `m3e-menu` は `m3e-card` の中に置くと開かない（slot 内で `show()` しても高さ 0 のまま）。カードの外に置き `m3e-menu-trigger` の `for` で結ぶ。
- `m3e-bottom-sheet` の `detents` は属性（空白区切り）でしか渡せず、`open` 属性だけでは取っ手の 16px しか出ない。`ref` で属性を設定し `show(1)` で開く。
- `m3e-list-action` の既定 slot に複数のテキストノードを置くと 2 行になるので、1 行目は 1 つの `span` に包む。選択中の行は `--m3e-list-item-container-color` で塗る。
- ビューアの中央寄せは `justify-content: center` ではなく `margin-inline: auto`（はみ出した左端へスクロールできなくなる）。
- フローティングツールバーは `position: absolute` の `m3e-toolbar` に `z-index: 20`（吹き出しより手前）。

### 検証

- `vp check` 0 エラー、全パッケージ typecheck、`vp test` 16 ファイル 124 件、デモビルド成功。
- 撮影経路（`e2e/screenshots.mjs`）を新 UI に合わせて書き直し、26 画面（[`SCREENSHOTS.md`](SCREENSHOTS.md)）。`pnpm a11y`: 残る指摘は M3E calendar 内部（過去日セルの accessible name）のみ。

## 11. 5 回目の見直し（2026-10-13・画面構成そのものを一から）

利用者の指摘「画面の設計がおかしい。ダッシュボード／制作物一覧／エディタ／通知で、全体のページ構造自体から見直してほしい」を受け、画面を **ダッシュボード／制作物／エディタ** の 3 つ＋管理に絞った（提案ページで 5 問に回答: 詳細ページは無くす、溜まっているものは自分が関わる制作物だけ、通知はベルのパネルだけ、URL は制作物が主語、左メニューは 2 つ）。

### 直したこと（いまの構造の何がおかしかったか）

| 問題                                               | 対応                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 最初の画面「校正待ち」が校正者専用                 | **ダッシュボード**（`/`）: 役割ごとに自動で出る「あなたの担当」（校正する／返事をする／校了する／割り当てる）                              |
| 「溜まっているもの」がどこにも出ない               | ダッシュボード下段: 期限超過・校正者が未割当・動きがない（14 日）・納期が近い（14 日）。自分が関わる制作物だけ                             |
| 制作物に「詳細」と「校正画面」の 2 画面            | **エディタ**（`/works/:id`）に一本化。基本情報・校了・編集・閲覧権限・専門確認は引き出し「情報」、履歴・提出・比較・無効化は引き出し「版」 |
| URL の主語が版                                     | `/works/:id`（最新＝受付中の版、無ければ最後の版）、`/works/:id/v/2`（第2版）、`/works/:id/v/0`（ラフ）。旧 `/revisions/:id` は転送        |
| フォームのためだけのページ（登録・編集・閲覧権限） | 登録・編集はダイアログ。閲覧権限は管理画面のダイアログ（管理者は内容を閲覧しない: D3）とエディタ「情報」（閲覧できる管理者向け）           |
| 一覧が作業中も左に居座る                           | 制作物（`/works`）は探して開くだけの入口。行を押すとエディタ                                                                               |
| 通知が独立した画面                                 | アプリバーのベル（未読バッジ）→ パネル（`m3e-menu`）。押すと対象の版へ                                                                     |

### 実装

- **application**: `buildDashboard`（`usecases/dashboard.ts`）。閲覧可否はドメインで最終判定し、閾値は `dashboardPolicy` に外出し。テスト 5 件（割当前後、返事／校了の切替、期限超過と動きなし、権限なし）。
- **convex**: `dashboard.get`。`works.listMyWorks` を一覧と共用。
- **web**: `_app/index.tsx`（ダッシュボード）、`features/editor/{Editor,VersionsTab,InfoTab}.tsx`、`features/work/{NewWorkDialog,EditWorkDialog,AclPanel}.tsx`、`features/notifications/NotificationsBell.tsx`。削除: `queue`, `notifications`, `works.tsx`（list-detail）, `works/new`, `works/:id/edit`, `works/:id/acl`。
- エディタは版を切り替えても同じ画面に留まる。切替直後に前の版のクエリ結果が残るため、表示中の版の結果だけを使う（`dataRaw.revision.id === revisionId`）。
- 引き出しは 3 つのトグル（コメント／版／情報）で開閉し、「ピンの高さに並べる」「ピンだけ」を選ぶとコメントの引き出しは閉じる。狭い画面では引き出し全体がボトムシート。

### 検証

- `vp check` 0 エラー、全パッケージ typecheck、`vp test`（application 44 件、convex 8 件、web 4 件、domain）、デモビルド成功。
- 撮影経路を新構成に書き直し、28 画面（[`SCREENSHOTS.md`](SCREENSHOTS.md)）。`pnpm a11y`: 残る指摘は M3E calendar 内部のみ。

## 12. 6 回目の見直し（2026-10-14・サイドバーとレイアウトを M3 の規定に合わせる）

利用者の指示「まずサイドバーとレイアウトだけ直す。Navigation rail と Layout のガイドライン（overview 以外のページも）を確認して方針を出す」に対し、方針 3 点（通知は compact の下部バーの 3 件目／FAB「制作物を登録」をレールに／展開レールの既定は折りたたみ）を提示し、承認を得て実装した。

### 根拠にした規定（m3.material.io は作業環境から到達できなかったため、Android 版ガイド・material-components-android・M3E 2.9.2 の実装から取った）

| 項目                   | 規定                                                                                                                                                               | 本システムでの適用                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ウィンドウサイズクラス | compact <600 / medium 600–839 / expanded 840–1199 / large 1200–1599 / extra-large ≥1600                                                                            | `lib/useMedia.ts` の `useWindowClass()` と `styles.css` のメディアクエリ（599 / 839 / 1199）を対にした。旧来の 720 / 960 / 1280 は廃止                                         |
| クラス別のナビ         | compact: ナビゲーションバー（3–5 件）。medium: レール。expanded 以上: レール（展開はモーダルか標準）                                                               | compact: 下部バー 3 件（ダッシュボード・制作物・**通知**。管理者は 4 件）。medium: 折りたたみレール。expanded: 折りたたみ＋**モーダル**展開。large: **標準**展開（内容を押す） |
| レールの解剖図         | 上にメニュー（展開中は閉じるアイコン）、FAB（任意、elevation 0、展開時は拡張 FAB）、行き先 3–7 件。折りたたみ幅 96、展開幅 220–360、折りたたみ行高 64、展開行高 56 | `m3e-nav-rail mode="compact                                                                                                                                                    | expanded"` の既定トークン（96 / 220）をそのまま使う。メニュー → FAB「制作物を登録」（小 56、展開で拡張）→ 行き先。アカウントは右上に残す |
| モーダル展開           | surface-container、角 16、elevation 3、スクリム、Esc で閉じる                                                                                                      | `.shell__rail--modal` ＋ `.shell__scrim`。行き先を選ぶ・幅が変わる・Esc で閉じる                                                                                               |
| 展開状態の既定         | 折りたたみが既定。利用者の操作で展開                                                                                                                               | large では `localStorage` の `mf100.rail.expanded` に保存。expanded のモーダルは保存しない                                                                                     |
| ペインの余白           | compact 16 / medium 以上 24（**要確認**: 公式値の裏取りは未）                                                                                                      | `.shell__content` の左右 padding。以前の 40 を 24 に                                                                                                                           |
| 補助ペイン             | Canonical layout「supporting pane」: expanded 以上は固定幅 360 の補助ペイン、それ未満は下（ボトムシート）                                                          | エディタの引き出しは 360 固定（`.ws__body--panel`、`.gutter`）。839 以下はボトムシート（旧 960）                                                                               |

### 直したこと

- **制作物一覧の「登録」ボタンを撤去**し、レールの FAB に一本化（どの画面からでも登録できる。`/works?new=1` のダイアログを開く）。
- **通知**: 広い画面はアプリバーのベル、compact は下部バーの「通知」。どちらも同じパネル（`#notif-menu`）を開く。バーの項目は経路ではないため、M3E が押下で付ける選択状態を経路に基づいて戻す（`resync`）。
- `useMedia` をエディタから `lib/useMedia.ts` へ移し、レイアウト（`_app.tsx`）とエディタで同じ境界を使う。

### 実装上の知見（M3E 2.9.2）

- `m3e-nav-rail` は `m3e-nav-bar` を継承し、`mode` を React から切り替えれば `currentMode` が追従する（`m3e-nav-rail-toggle` は使わず、React 側で状態を持つ方が保存・モーダル判定を一元化できる）。
- 直下の `m3e-fab` は自動で elevation 0 になり、展開時に `extended` が付く。既定サイズ `medium`（80）は折りたたみ幅 96 に収まらないので `size="small"`（56）にする。
- `m3e-nav-item` は押すと自分を選択状態にする（`selected = true`）。経路以外の項目を置くときは `change` で戻す。
- `m3e-menu-trigger` は親要素の click を拾うので、`m3e-nav-item` の中に置けば項目全体がトリガーになる。

### compact（スマホ幅）の作り直し（同日・利用者指摘「感覚がバラバラ」「検索バーとアイコンの高さも M3 の規定に」）

規定値は M3E 2.9.2 の既定トークン（M3 の仕様値をそのまま持つ）と material-components-android の `Search.md` から取った。

| 部品                   | M3 の規定                                                                                  | 適用                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| トップアプリバー（小） | 高さ 64。コンテナ余白 4、題名は title-large（22/28）、副題は label-medium                  | 共通バーは M3E 既定のまま。compact のエディタは共通バーを消し、エディタ自身の `m3e-app-bar`（戻る・題名・副題に版と状態・末尾に添付切替と確認完了）                 |
| 検索バー               | 高さ 56、角 full、先頭アイコン 24 を 16 内側に、末尾のアバター 30、左右の余白 16（単独時） | compact は検索バーがアプリバーそのもの: コンテナ余白 12 ＋題名スロット 4 ＝ 16、アバター（30）を検索バーの末尾に移し右端 16（`--m3e-search-bar-trailing-space: 7`） |
| アイコンボタン         | 容器 40、タッチ 48、アイコン 24                                                            | M3E 既定（`size="small"`）。アバターだけ `--m3e-icon-button-icon-size: 30`                                                                                          |
| ナビゲーションバー     | M3E 既定（最小 64。縦並び項目で 68）                                                       | そのまま。要確認: M3 Expressive の高さ規定（64 / 80）                                                                                                               |
| 余白                   | compact 16                                                                                 | 本文 16。題名ブロック（`.page-header`: 上 8・高さ 40・下 16）を全画面で共通化し、題名が常に同じ高さ（y=84）に来る                                                   |
| リスト                 | compact は端から端まで（本文の左端 16 が題名と揃う）                                       | `.list { margin: 0 -16px }`（`.list` の後ろに置かないと負ける）、角 0                                                                                               |
| 補助ペイン（compact）  | 下に置く（ボトムシート）                                                                   | detent `60px half full`（覗き見＝タブだけ）で開始。紙面は幅に合わせ（`fitWidth`: PDF・画像とも舞台幅 − 32）、ツールバーは覗き見の 16 上                             |

- **なぜ崩れていたか**: 共通の検索バー＋エディタの見出し 3 行＋ツールバー（レイアウト切替まで含む）＋半開きのシートが 412px に全部乗っていた。紙面は等倍で横にはみ出し、見出しとリストの左端も 8px ずれていた。
- 共通バーと下部バーを消す判断は M3 の list-detail（compact では詳細が独自のトップアプリバーを持つ）に従う。戻るはアプリバーの先頭。
- `PdfViewer` は倍率や幅が続けて変わると同じ canvas に二重描画してエラーになるため、前の描画を `cancel()` してから描く。

### 検証

- `vp check` 0 エラー、全パッケージ typecheck、`vp test`、デモビルド成功。
- 撮影 34 画面（#29 標準展開レール、#30 モーダル展開レール、#31 FAB からの登録ダイアログ、#32 compact の通知、#33 compact の一覧、#34 シートを半分）。`pnpm a11y`: 残る指摘は M3E calendar 内部の 1 件のみ。
