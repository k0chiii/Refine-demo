import { expect, test } from "../support/app";
import { submitFirstRevision } from "../support/scenarios";

// MF100 Notion「校正システム」: 返信のたびに右の引き出しが開き、紙面が拡大縮小する。返信欄はカードの下でよい
test.describe("紙面の横のカードからの返信", { tag: "@core" }, () => {
  for (const layout of ["ピンの高さに並べる", "ピンだけ"]) {
    test(`「${layout}」では、カードの下の返信欄から返し、引き出しは開かず紙面の大きさも変わらない`, async ({
      app,
      page,
    }) => {
      const { revisionPath } = await submitFirstRevision(app);
      await app.signInAs("mock-nogiku-reviewer");
      await app.go(revisionPath);
      await app.pdfReady();
      await app.drawer("コメント");
      await app.commentOnRect(0.2, 0.2, 0.5, 0.3, "団体名の表記が規約と違います。");

      await app.signInAs("mock-nogiku-creator");
      await app.go(revisionPath);
      await page.locator('m3e-icon-button[aria-label="コメントの表示"]').click();
      await page.locator("m3e-menu-item-radio", { hasText: layout }).click();
      await app.settle();
      const sheet = page.locator(".viewer__overlay").first();
      const before = await sheet.boundingBox();

      const card = page.locator(".thread", { hasText: "団体名の表記" }).first();
      if (layout === "ピンだけ")
        await sheet.getByLabel("コメント 1", { exact: true }).first().click();
      else await card.locator(".thread__body").first().click();
      const reply = card.locator(".thread__inline-reply");
      await reply.locator(".rt__content").fill("3 ページ目の見出しです。");
      await reply.locator(".rt__send").click();

      await expect(card.locator(".thread__replies")).toContainText("1");
      await expect(page.locator(".thread-panel")).toHaveCount(0);
      await app.settle();
      expect(Math.round((await sheet.boundingBox())!.width)).toBe(Math.round(before!.width));
    });
  }
});
