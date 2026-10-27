# コメントと採否

校正者が紙面をなぞって（範囲）、または位置なしでコメントする。コメントは制作者の通知（ベル）に届く。制作者はスレッドのパネルの「その他の操作」から理由を付けて不採用にでき、スレッドが閉じる。

## Sub-features

- `comment-rect` 紙面をなぞってコメント（紙面に印が出る）。
- `comment-free` 位置なしのコメント。
- `comment-notify` 制作者のベルに通知が届く。
- `decision-reject` 理由を付けて不採用にするとスレッドが閉じる。
- `reply-edit` 返信した本人が返信の「⋮」→「訂正」で本文を直せる（管理者でも他人の返信は直せない）。
- `edited-mark` 訂正したコメント・返信は本文の後ろに「編集済み」の印（`.thread__edited`）。流れに原文の行は出ない。
- `thread-subscribe` パネルのベル（`.thread-panel__subscribe`）で購読すると、メンションされていなくても返信の通知がベルに来る。
- `compose-in-panel` 840px 以上では、なぞる・位置なしの投稿欄が紙面ではなく引き出し「コメント」の一番下（`.comments__compose`）に出る。

## How to get to it (user POV)

- 校正者で「校正」の行から版を開き、引き出し「コメント」。紙面をなぞる、または一覧の下の入口。
- 制作者でアプリバーのベル。
- 制作者でコメントのカードの下の行 → パネルの「その他の操作」→「不採用」。

## Driving it with Playwright

Preconditions:

- 版がある（`scenarios.submitFirstRevision`）。紙面から始めるなら校正者の割り当ても（`scenarios.assignReviewer`）。

- **なぞる.** `app.commentOnRect(0.15, 0.12, 0.6, 0.22, "本文")`。`.comments .thread` が 1 件、`.viewer__overlay [data-anchor]` が 1 つ以上。
- **位置なし.** `app.freeComment("本文")`。スレッドが 1 件増え、入れた本文のカードがある。
- **通知.** 制作者で `.bell m3e-icon-button[aria-label^="通知"]`。`#notif-menu .notif` が出て、制作物の題名を含む。
- **不採用.** 制作者で `app.openPanel(カード)` →「その他の操作」→「不採用」→ 理由 →「不採用にする」。カードに `thread--closed`。
- **返信の訂正.** `app.openPanel(カード)` → `.thread-panel__composer` で返信 → 返信の `m3e-icon-button[aria-label="返信の操作"]` →「訂正」→ 本文を直して「訂正を保存」。`.thread__replyitem .thread__edited` が 1 つ。元のコメントは「その他の操作」→「訂正」で同じく `.thread-panel__root .thread__edited`。`.thread__previous` は無い。
- **投稿欄の場所（広い画面）.** 引き出しを「版」にしてから紙面をなぞると、引き出しが「コメント」になり `.comments__compose .compose-pop .rt__content` が出る。`.viewer .compose-pop` は 0。
- **証拠.** `npx playwright test comment comment-thread comment-compose notifications decision --trace on`。

## Gotchas

- 紙面のふつうのクリックはコメントにならない（なぞる・長押しだけ）。
- 839px 以下は投稿欄が画面下（またはシートの下）、600〜839px は選んだ位置のそばに浮かぶ。引き出しの下に出るのは 840px 以上だけ。
- スレッドのパネルを開いているあいだ、同じスレッドが一覧とパネルの 2 か所にある。件数はカード（`.comments .thread`）を絞って数える。
- ページを読み直すとコメントは消える（デモのデータはメモリ）。
