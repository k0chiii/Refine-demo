# 版の比較

版が 2 つ以上ある制作物で、アプリバーの「比べる」から別の版を選ぶと、2 つの版の紙面が左右に並ぶ。「比べるのをやめる」で 1 つに戻る。

## Sub-features

- `compare-open` 第2版を開いて第1版と並べる。
- `compare-close` 比べるのをやめる。

## How to get to it (user POV)

- 版を開いた画面のアプリバー「比べる」（広い画面はメニュー、スマホは下からのシート）。

## Driving it with Playwright

Preconditions:

- 版が 2 つある（`scenarios.submitFirstRevision` → `scenarios.submitNextRevision(app, 2)`）。

- **並べる.** `app.compareWith("第1版")`。`.compare__pane` が 2 つ、どちらも紙面の canvas の幅が 0 より大きい。
- **やめる.** `app.compareWith("比べるのをやめる")`。`.compare__pane` が無くなる。
- **証拠.** `npx playwright test compare --trace on`。

## Gotchas

- 2 つ目の紙面は遅れて描かれる。canvas の幅を `expect.poll` で待つ。
- スマホ幅ではメニューではなくシート（`app.compareWith` が幅で切り替える）。
