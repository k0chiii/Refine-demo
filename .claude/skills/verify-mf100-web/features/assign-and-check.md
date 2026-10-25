# 校正者の割り当てと「校正」

主管が版のある制作物に校正者を割り当てる。グループを選ぶと所属する人がまとめて入り、要らない人は外せる。割り当てられた校正者の「校正」（`/check`）に未着手として出て、ナビの「校正」に自分の手が要る数のバッジが付く。スマホ幅でも一覧は横にはみ出さない。

## Sub-features

- `assign-person` 人を 1 人選んで割り当てる。
- `assign-group` グループ（`こうせいはん`）を選んで、一部を外して割り当てる。
- `check-list` 校正者の「校正」に出る・切り替えが 3 つ・行ごとの次の操作の印・ナビのバッジ。
- `check-mobile` 412px・360px で長い題名の行も右端で切れない。
- `picker-ime` ユーザーの選択欄で、日本語入力の「確定」（iPhone の Safari は keyCode 229）が候補の決定に取られない。ふつうの Enter は先頭の候補を決める。

## How to get to it (user POV)

- 主管で制作物（版あり）を開き、引き出し「情報」→「校正者を割り当てる」。
- 校正者でナビの「校正」。

## Driving it with Playwright

Preconditions:

- 版がある制作物（`scenarios.submitFirstRevision`）。

- **割り当て.** 主管で `app.drawer("情報")` →「校正者を割り当てる」→ `app.pickUser(app.dialog(), "こうせいはん")`。`m3e-input-chip` が 2 つ。校了者のチップの「を外す」で 1 つ。「割り当てる」でダイアログが閉じる。
- **校正者から見る.** `app.signInAs("mock-nogiku-reviewer")` → `app.go("/check")`。制作物の行が出る。`.hub .hub__tabs m3e-button` が 3 つ、`m3e-nav-item[data-to="/check"] .badge` が数字。
- **スマホ.** `page.setViewportSize({ width: 360, height: 780 })` → `/check`。`documentElement.scrollWidth <= clientWidth`、長い題名の行の右端 ≤ 画面の幅。
- **日本語入力.** 主管で `/works` → 行の「… の校正者を選ぶ」→ `.picker__input` に `fill("ほんごう")` → `app.imeConfirm(input)`。文字が残りチップは 0。候補が出てから `press("Enter")` でチップが 1。
- **証拠.** `npx playwright test assign-reviewer mobile-check --trace on`。

## Gotchas

- 割り当ての候補は M3E の autocomplete（`option` ロール）に出る。打ってすぐ押すと外れるので `app.pickUser` を使う。
- 日本語入力の確定は Playwright の `press` では作れない。`app.imeConfirm`（Safari の形の keydown）を使う。
- スマホ幅の確認は、長い題名の制作物（`LONG_TITLE`）に版と割り当てを用意してから。シードのままだと行が無い。
