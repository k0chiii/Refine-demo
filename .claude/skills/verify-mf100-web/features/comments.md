# コメントと採否

校正者が紙面をなぞって（範囲）、または位置なしでコメントする。コメントは制作者の通知（ベル）に届く。制作者はスレッドのパネルの「その他の操作」から理由を付けて不採用にでき、スレッドが閉じる。

## Sub-features

- `comment-rect` 紙面をなぞってコメント（紙面に印が出る）。
- `comment-free` 位置なしのコメント。
- `comment-notify` 制作者のベルに通知が届く。
- `decision-reject` 理由を付けて不採用にするとスレッドが閉じる。

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
- **証拠.** `npx playwright test comment notifications decision --trace on`。

## Gotchas

- 紙面のふつうのクリックはコメントにならない（なぞる・長押しだけ）。
- スレッドのパネルを開いているあいだ、同じスレッドが一覧とパネルの 2 か所にある。件数はカード（`.comments .thread`）を絞って数える。
- ページを読み直すとコメントは消える（デモのデータはメモリ）。
