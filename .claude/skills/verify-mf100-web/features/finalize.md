# 校了

校了者が版のある制作物で「校了を宣言」し、ダイアログで確定する。人の未解決のコメントや未完了の専門確認が残っているときは、例外校了の理由を書かないと校了できない（A-08）。校了すると「校了を宣言」が消え、制作者の「制作」の「校了済み」に出る。

## Sub-features

- `finalize-clean` 未解決が無い制作物を校了する。
- `finalize-exception` 未解決が残ると理由なしでは校了されず、理由を書けば校了される。
- `finalize-done-list` 制作者の「制作」→「校了済み」に出る。

## How to get to it (user POV)

- 校了者で制作物を開き、引き出し「情報」→「校了を宣言」→「校了を確定する」。
- 制作者でナビの「制作」→ 切り替えの「校了済み」。

## Driving it with Playwright

Preconditions:

- 版がある（`scenarios.submitFirstRevision`）。例外校了なら校正者のコメントも（`scenarios.reviewerComments`）。

- **確定.** `app.signInAs("mock-nogiku-approver")` → 制作物 → `app.drawer("情報")` →「校了を宣言」→「校了を確定する」。ダイアログが閉じる。校了したかは下の「一覧」で確かめる。
- **理由なし.** 未解決があるとき、ダイアログに `.alert--warn` が出る。「校了を確定する」を押してもダイアログは閉じない。
- **理由あり.** `dialog.getByLabel("例外校了の理由").fill(...)` → 確定。ダイアログが閉じ、「一覧」に出る。
- **一覧.** 制作者で `/make` → `getByRole("radio", { name: "校了済み" })`。制作物のボタンがある。
- **証拠.** `npx playwright test finalize --trace on`。

## Gotchas

- 「校了済み」は URL ではなく切り替え（radio）。`/make?view=done` のような URL は無い。
- 自動校正のコメントは校了を止めない。止めるのは人のコメントだけ。
- 「校了を宣言」が消えるのは、自分が宣言しただけでも起きる（校了者が複数なら人数に届くまで校了にならない）。校了の証拠にしない。
