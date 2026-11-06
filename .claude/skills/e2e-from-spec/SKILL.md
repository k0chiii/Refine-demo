---
name: e2e-from-spec
description: "MF100 の受け入れ条件（docs/REQUIREMENTS.md・docs/TEST_PLAN.md の A-xx）や手動テストの手順、または「この機能の E2E を足して」から、Playwright Test の spec（apps/web/e2e/specs）を作って PR に載せる。既存の spec と重ならないか・単体テストで済まないかを先に判断する。E2E を足す・直すとき、受け入れ条件をテストにするときに使う。"
---

# 受け入れ条件から E2E の spec を作る

kickflow の「手動テストを渡すだけで E2E が完成する」と同じ考え方を、MF100 の決まり（`docs/TESTING_AGENT_POLICY.md`・`docs/TEST_PLAN.md`）で行う。
pstack を使っているなら、この手順は `/pstack:poteto-mode` の中で、テストの原則は `principle-test-behavior-not-implementation`、不具合の回帰は `tdd` に従う。

## 1. 仕様の根拠を確かめる

- 入力（受け入れ条件の ID・手動テストの手順・依頼文）を、**誰が・何をして・どうなるべきか**の 1〜3 行にする。
- 根拠を `docs/REQUIREMENTS.md`（正本）・`docs/DECISIONS.md`・`docs/TEST_PLAN.md` で探して引用する。**未承認（D2/D3 など）の事項をテストで確定しない**。根拠が無ければ、書く前に利用者に聞く。

## 2. E2E にするかを決める

次の表で判断し、結論と理由を 1 行で残す。

| 確かめたいこと                                       | 置き場所                                           |
| ---------------------------------------------------- | -------------------------------------------------- |
| 条件・境界・権限・状態遷移（画面が無くても決まる）   | `packages/domain` / `packages/application` の単体   |
| Convex の関数・HTTP の契約・認可                     | `apps/convex/convex/*.test.ts` / `apps/api`         |
| 画面の操作でしか起きないこと・複数の人をまたぐ流れ   | **E2E の spec**（ここから先）                       |
| 見た目・文言                                         | テストにしない（撮影で目視。`screenshots.mjs`）     |

E2E にするのは代表の 1〜2 例だけ。境界の網羅は単体で。

## 3. 重なりを探す

- `.claude/skills/verify-mf100-web/features/` の地図と `apps/web/e2e/specs/` を読み、同じ流れを確かめている spec を探す。
- あれば、その spec に `test` を足すか、確かめる点を足す。新しいファイルにしない。
- 前提づくりが `apps/web/e2e/support/scenarios.ts` に無ければ、そこに足す（撮影も検証もしない、速い手順として）。

## 4. 書く

```ts
import { expect, test } from "../support/app";
import { submitFirstRevision } from "../support/scenarios";

// <受け入れ条件 ID・根拠の節>
test.describe("<機能>", { tag: "@core" }, () => {
  test("<誰が・何をすると・どうなる>", async ({ app, page }) => {
    const { workPath } = await submitFirstRevision(app); // 前提は自分で用意する
    await app.signInAs("mock-nogiku-manager");
    // 操作 …
    await expect(/* 状態・件数・URL・ユーザーが入れた値 */).toBe…;
  });
});
```

- 画面の操作の手がかり（M3E のタグ・クラス・ダイアログの開き方）は `e2e/support/app.ts` の `App` に足して、spec からはメソッドで呼ぶ。
- 文言を確かめない。固定の待ち（`waitForTimeout`）を使わない。`.first()` は「同じものが 2 か所にある」理由があるときだけ。
- 「出ない」を確かめるときは、前提（読み込み済み・権限が決まった）を先に肯定的に確かめる。
- タグは `@core`。PR で必ず流すべき主要な流れだと利用者が判断したときだけ `@smoke`。
- 振る舞いの検査: 実装をわざと壊したら落ちるか（落ちないなら確かめていない）、内部を作り替えても通るかを考える。

## 5. 流す

```bash
cd apps/web
CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e <ファイル名>                       # デモ版のビルドから
CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e <ファイル名> --repeat-each=3 --workers=4   # 揺れないか
cd ../.. && pnpm check && pnpm typecheck
```

- 不具合の回帰テストなら、直す前に落ちる（意図した理由で）ことを確かめてから直す。
- 落ちたら `e2e/out/test-results/*/trace.zip` を `pnpm exec playwright show-trace` で見る。テストを弱めて通さない。

## 6. 地図と PR

- `.claude/skills/verify-mf100-web/features/` の該当ファイルに、新しい sub-feature と運転の手順を 1 行足す（新しい機能ならファイルを足し、README の一覧にも）。
- PR の本文に次の表を書く。流していないものを「通った」と書かない。

| 受け入れ条件 | 確かめる点 | spec | 流したコマンド | 結果 | 確かめていないこと |
| ------------ | ---------- | ---- | -------------- | ---- | ------------------ |
