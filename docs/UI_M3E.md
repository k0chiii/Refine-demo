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
| ナビ               | 広い画面は `m3e-nav-rail`、720px 以下は `m3e-nav-bar`（下部固定）。未読数は `m3e-badge`（画面 #21）                                                                                                   |
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
