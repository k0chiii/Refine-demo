import { expect, test } from "../support/app";
import { reviewerComments, submitFirstRevision } from "../support/scenarios";

// 利用者指示 2026-10-28「コメントで2列取るのはやめよう」→ 試作 B（一覧を差し替え、上の段で前後へ）。docs/UI_M3E.md §104
test.describe("スレッドのパネルの前後", { tag: "@core" }, () => {
  test("スレッドを開いても引き出しは広がらずに一覧を差し替え、上の段の前後で一覧の並びの隣のスレッドへ移り、戻ると一覧が出る", async ({
    app,
  }) => {
    const { revisionPath } = await submitFirstRevision(app);
    await reviewerComments(app, revisionPath, "凡例の文字の大きさを確認してください。");
    await reviewerComments(app, revisionPath, "表紙の団体名の表記を確認してください。");
    const cards = app.threads();
    await expect(cards).toHaveCount(2);
    const firstId = await cards.nth(0).getAttribute("data-thread-id");
    const secondId = await cards.nth(1).getAttribute("data-thread-id");
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
    const drawer = app.commentsDrawer();
    const before = (await drawer.boundingBox())?.width;
    expect(before).toBeGreaterThan(0);

    const panel = await app.openPanel(cards.nth(0));
    await expect(panel).toHaveAttribute("data-thread-panel", firstId!);
    expect((await drawer.boundingBox())?.width).toBe(before);
    await expect(app.commentsList()).toBeHidden();
    const { prev, next } = app.threadNav(panel);
    await expect(prev).toHaveAttribute("disabled");
    await expect(next).not.toHaveAttribute("disabled");

    await next.click();
    await expect(panel).toHaveAttribute("data-thread-panel", secondId!);
    await expect(next).toHaveAttribute("disabled");
    await expect(prev).not.toHaveAttribute("disabled");
    expect((await drawer.boundingBox())?.width).toBe(before);

    await app.closePanel(panel);
    await expect(app.commentsList()).toBeVisible();
    expect((await drawer.boundingBox())?.width).toBe(before);
  });
});
