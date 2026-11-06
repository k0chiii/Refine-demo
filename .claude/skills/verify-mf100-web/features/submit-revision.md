# 版の提出

制作者が制作物に版（ファイル一式）を出す。最初の版は「最初の版を提出」、以降は引き出し「版」の「新しい版を提出」。ファイルを置いて転送・検証が済むと確定でき、確定すると `/works/<id>/v/<n>` の紙面が開く。次の版では前版の未解決コメントを持ち越せる。

## Sub-features

- `submit-first` 最初の版を複数ファイル（PDF・画像・テキスト）で出す。
- `submit-gate` ファイルを置くまで「アップロードを開始」は押せない。
- `submit-checks` 専門確認（写真など）を校正者に頼む・提出前の確認と申告に印を付ける。
- `submit-next` 次の版を出す（版の番号が 1 つ進む）。
- `carry-forward` 前版の未解決コメントを次の版へ持ち越す。

## How to get to it (user POV)

- 制作物一覧（`/works`）で制作物を開き、版が無い画面の「最初の版を提出」。
- レールの「作る」→「版を提出」→ 制作物を選ぶ。
- 版を開いた画面の引き出し「版」→「新しい版を提出」。

## Driving it with Playwright

Preconditions:

- 制作者でサインインしている（`app.signInAs("mock-nogiku-creator")`）。
- 対象の制作物に版が無い（シードのまま）。次の版なら `scenarios.submitFirstRevision` を先に。

- **開く.** `await app.openWork("MF100 公式パンフレット")`。`.editor__empty` が見える。
- **置く.** `await app.uploadRevision("最初の版を提出", [fixture("sample.pdf"), fixture("poster.png")], "初稿。", () => app.tickSelfChecks())`。`.upload-item__state--verified` がファイルの数だけ出る。
- **確定.** `await app.confirmRevision(1)`。URL が `/v/1` で終わり、紙面の canvas が描かれる。
- **次の版.** `await scenarios.submitNextRevision(app, 2)`。URL が `/v/2`。
- **持ち越し.** 第1版に校正者のコメント（`scenarios.reviewerComments`）がある状態で第2版を出し、`app.drawer("コメント")`。`[aria-label="前版の未解決コメント"]` にそのコメントが出る。「この版へ持ち越す」でコメントの一覧が 1 件増える。
- **証拠.** `npx playwright test submit-revision carry-forward --trace on` の trace。

## Gotchas

- 提出前の確認（3 つ）は提出を止めない。止めるのは「ファイルが無い」こと。
- 確定の直後は自動校正（OCR）が走る。紙面の確認は canvas の幅で待つ（文言の「読み込んでいます」では待たない）。
- 版の番号は URL（`/v/<n>`）で確かめる。表示の「第1版」の文言では確かめない。
