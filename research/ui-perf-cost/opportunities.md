# 画面・軽量・帯域・コストの洗い出し（2026-10-23）

根拠はリポジトリのコードと `docs/COST.md`（見積り。本番 Insights ではない）、および `research/ui-perf-cost/sources/` の公式原文。金額は断定しない。コード根拠は how explorers（UI / フロント / Convex / CF·R2）の突合。

## Overview

コストの本体は Convex の DB 帯域（読み取り × 購読の再実行）である。`workSummaries` は一覧と `works.get` の指摘件数を軽くしただけで、`dashboard.get` はまだ進行中の全制作物の版・スレッド・割当・専門確認を読む。フロントは SW の全 JS/CSS precache とログイン後の全ルート先読みが支配的。要件正本（U-01〜U-08・後続）より DECISIONS / UI_M3E の古い節と FEATURES_V2 が画面を増やしている。

## すでに入っているもの（山を下げた）

| 項目 | 状態 |
| --- | --- |
| `workSummaries` / `listMinePage` | 実装済み（C02/C04/C05）。ダッシュボードは未使用 |
| `home.submitTargets` の workRoles 絞り込み | 実装済み（C01）。`rolesVersion` 未設定は全件フォールバック |
| 版の `unresolvedCount` 等 | 実装済み。無い行だけスレッド列挙 |
| R2 Range HEAD 省略・認可集約・`_headers`・SW 写し | COST 記載どおり。認可キャッシュは A-11 で見送り |
| FB `listSpaces` | 無し。`feedback/` はリダイレクトのみ |
| ビューアの `lazy()`・OCR 動的 import・アイコンサブセット | 済み |

## 優先リスト（効果 / 手間）

| 優先 | 領域 | 内容 | 効果（見積り or 推論） | 手間 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| P0 | 帯域 | `dashboard.get` を要約駆動に（ラベル・締切・未解決・割当等を `workSummaries` へ）。個人キューは `checkBadge` 系索引へ | 1.85MB→約 0.5MB/実行。スレッド・版書込みがホーム購読を再実行しにくくなる（COST 推奨 1） | 大（拡張・バックフィル要承認） | `dashboard.ts`、`buildDashboard`、`lib/workSummary.ts`（`latestId`/`acceptingId`/`declared` のみ） |
| P0 | 計測 | Convex Insights で関数別 DB 帯域を週次確認 | 見積りを実測に置き換える | 小 | COST §6–7、usage limits |
| P1 | 帯域 | ダッシュボードを節ごとの query に分割（推奨 2） | 表示中の節だけ再実行 | 中（ローダーを変えない） | COST §5、入口は `index`/`make`/`check`/`works` |
| P1 | 帯域 | `summarizeWorkList` が要約があっても最新版・受付中を `findById` しないようラベル・締切を要約へ | 版書込みで一覧が再実行されにくくなる | 中 | `works.ts`、`useWorkSummaries.ts` |
| P1 | 帯域 | `listMinePage` の CanLoadMore 全ページ読み切りをやめる | 購読ドキュメント数が減りうる | 中（件数・並びの UX） | 一覧・校了・`CrossWorkPicker`、C02 |
| P1 | フロント | SW precache を index・エントリ・CSS・アイコン等の必須だけに | 初回バイトと install。遅延チャンクが初回に落ちなくなる | 中 | `vite.config.ts` `pwa()`、`sw.template.js` |
| P1 | フロント | `_app.tsx` の idle 全ルート `preloadRoute` と校正チャンク先読みをやめるか遅延 | ホーム滞在時の帯域とメインスレッド | 小〜中 | `_app.tsx`、`main.tsx` `defaultPreload: "intent"`、`earlyPreload.ts` |
| P2 | 要件/UI | 入口の三重を正本に寄せる（`make` と `works` の重複、`write` と制作下書き） | 購読の重複と認知負荷 | 中（製品・IA） | REQUIREMENTS U-02、`DashboardOverview` |
| P2 | 要件/UI | 比較一式・ProcessingTools・表記 CMS・SNS 模擬・Web/動画ライブ注釈を「後続」へ退避 or デモ非表示を徹底 | バンドルと要件ずれ | 中（製品判断） | §3.2 / U-05 / F-10 / F-12、FEATURES_V2、DECISIONS と正本の食い違い |
| P2 | フロント | `Editor.tsx` から比較・提出・ProcessingTools 等を lazy | 紙面オープン時のパース | 中 | 静的 import。`hls.js` は既に動的 |
| P2 | フロント | Noto Sans JP 可変のサブセット／段階読み | CSS 約 105KB・woff2 合計約 5.5MB（推論） | 中 | `fonts.ts`、`@fontsource-variable/noto-sans-jp` |
| P2 | フロント | PDF.js modern 化、`preloadViewers` が image/figma で PDF を先読みしない、`warmPdfAssets` を PDF 以外で止める | 数十 KB〜数百 KB 級＋無駄な idle 作業 | 小〜中 | `pdfjs.ts`、`lazyViewers.tsx` |
| P2 | フロント | OCR の未使用 `jpn_vert` と余分な WASM を配信から外す | デプロイと初回 OCR | 小 | `vite.config.ts` `ocrAssets()` |
| P2 | 帯域 | 候補ごとの版全読みを要約化。本番 `rolesVersion` / workRoles 埋め確認 | 常時購読の残り | 小〜中 | `listSubmitTargets`、COST 推奨 4 |
| P3 | R2/Worker | 16MB 以上 multipart の完了時全体再読をやめ part 中ハッシュ。未完了 7 日 abort（F08） | Class A/B・CPU・放置保存 | 中 | `multipart.ts`（COST §2.4 の「未使用」は古い） |
| P3 | R2/Worker | PDF 遠い範囲のまとめ、Stream トークン窓内再利用、gzip 検証の Class B | Class B / Worker 往復 | 中 | `pdfjs.ts` 64KB、`streamProcessing.ts`、`receiveUpload` |
| P3 | 運用 | Pages プレビュー停止、`head_sampling_rate: 1` を下げる | ビルド分・ログ | 小 | COST §6.2、`wrangler.jsonc` |
| P3 | 掃除 | `reviews.myQueue` 削除 or 直して使う。DECISIONS / UI_M3E の古い IA 節を正本に合わせて消すか注記 | ノイズと二重実装の温床 | 小 | COST、REQUIREMENTS vs DECISIONS |

## やらない／後回し

| 項目 | 理由 |
| --- | --- |
| 本番データなしのバックフィル実行 | 明示承認が要る（CLAUDE.md） |
| egress 課金の最適化を主目的にする | R2 egress は無料（公式 pricing / COST） |
| 認可キャッシュ・認可つきファイルの公開キャッシュ | A-11 |
| Smart Placement だけ先に入れる | 効果はリージョン次第。実測が先（COST 推奨 9） |
| `marked` の遅延化 | スレッド常時。後回しでよい |

## 次の一手（推奨順）

1. Convex Insights で現状の上位関数を1回見る（P0 計測）。
2. `dashboard.get` 要約化の設計だけ切る（実装は Feature / TDD）。
3. SW precache とログイン先読みの差分を Prototype で測る。
4. 入口の二重と「後続」画面の製品スコープを決める（正本と DECISIONS の食い違いの解消）。

## 実装状況（2026-10-23）

- 入った: SW shell precache、idle 先読み削除、Editor lazy、PDF modern、OCR SIMD 1本、workSummaries v2＋フォールバック、Stream トークン再利用、sampling 0.1、myQueue 削除、COST 事実修正。
- 追加で入れた: dashboard 節分割（check/make/works）、backfillWorkSummaries、multipart の isolate 内ハッシュ（全文 GET はフォールバック）。
- 見送りのまま: 機能削除、入口統合、Noto サブセット、Insights、Pages プレビュー停止。multipart の横断 isolate 永続ハッシュは未着手。
