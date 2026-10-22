# MF100 Web の確かめ方の地図

デモ版の Web で、利用者から見える機能を確かめるときの手順書。運転の前にここを読み、該当する機能のファイルを手順として使う。

## Baseline preconditions

- デモ版が `http://127.0.0.1:4173` で動いている（`../SKILL.md` の Launch）。`scripts/doctor.mjs` が OK を返す。
- データはシード（制作物 `MF100 公式パンフレット`・`EVE 企画ポスター`・`100nc_デザインガイドライン…` など。どれもまだ版が無い）。
- アカウント: 制作者 `mock-nogiku-creator`、校正者 `mock-nogiku-reviewer`、主管 `mock-nogiku-manager`、校了者 `mock-nogiku-approver`、管理者 `mock-nogiku-admin`。
- 自分が建てたのではない preview は運転しない。

## Driving conventions

- 各手順は、新しいページ（＝シードの状態）から始める。前提は `apps/web/e2e/support/scenarios.ts` の手順で用意する。
- 手がかりはロール・ラベルを先に、次に M3E のタグと操作の文言。紙面の上の操作（なぞる・長押し）は座標の割合で。
- 移動は `app.go()`。`page.goto` はデータを消す。
- 確かめるのは文言ではなく状態（URL・状態のクラス・件数・ユーザーが入れた値）。

## Proof and skip reporting

- 操作と結果の状態の両方を残す（trace と終わりのスクリーンショット）。
- 変わったものは、別の人・別の画面からもう一度見る。
- 証拠には機能の ID と入口を付ける。
- 届かない道は、試したことと満たせなかった前提を書く。別の道で確かめたものを、その道で確かめたと書かない。

## Feature entry contract

各ファイルは H1 と、利用者から見える振る舞いの 1 段落で始め、次の 4 つの H2 をこの順に持つ: `Sub-features` / `How to get to it (user POV)` / `Driving it with Playwright` / `Gotchas`。実装の詳細は書かない。

## Features

- [版の提出](./submit-revision.md) — 最初の版・次の版、複数ファイル、専門確認の依頼、持ち越し。spec: `submit-revision`・`carry-forward`
- [校正者の割り当てと「校正」](./assign-and-check.md) — 主管の割り当て（人・グループ）、校正者の「校正」の一覧、スマホ幅。spec: `assign-reviewer`・`mobile-check`
- [コメントと採否](./comments.md) — 紙面をなぞる・位置なし、通知、不採用。spec: `comment`・`decision`・`notifications`
- [校了](./finalize.md) — 校了の確定、未解決が残るときの例外校了。spec: `finalize`
- [版の比較](./compare.md) — 2 つの版を並べる・やめる。spec: `compare`
