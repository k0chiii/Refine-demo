import { expect, test } from "../support/app";
import { submitFirstRevision, submitNextRevision } from "../support/scenarios";

// 利用者決定 2026-10-27「制作物を購読（構成者に割り当てられてなくても、ダッシュボードに出たり版更新の通知が出たりするようにしたい）」。
// ピン留めを購読として扱う（DECISIONS「ピン留めを購読に・スレッドの購読」）
test.describe("ピン留め（制作物の購読）", { tag: "@core" }, () => {
  test("割り当てられていない人がピン留めすると、次の版の通知が届き、校正の入口のピン留めに出る", async ({
    app,
    page,
  }) => {
    const { workPath, revisionPath } = await submitFirstRevision(app);

    await app.signInAs("mock-nogiku-reviewer");
    await app.go(workPath);
    await app.pdfReady();
    await app.pin();

    await app.signInAs("mock-nogiku-creator");
    await app.go(revisionPath);
    await app.pdfReady();
    const secondPath = await submitNextRevision(app, 2);

    await app.signInAs("mock-nogiku-reviewer");
    await app.go("/check");
    await expect(app.checkPinned()).toHaveCount(1);
    await expect(page.locator(".hub[data-hub='check'] .hub-row")).toHaveCount(1);

    const notes = await app.notifications();
    await expect(notes).toHaveCount(1);
    await notes.click();
    await page.waitForURL((u) => u.pathname === secondPath);
  });
});
