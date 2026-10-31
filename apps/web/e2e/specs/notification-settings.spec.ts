import { expect, test } from "../support/app";

test.describe("通知の設定", { tag: "@core" }, () => {
  test("アカウントのメニューから開き、メールで受け取る設定が開き直しても保たれる", async ({
    app,
  }) => {
    await app.signInAs("mock-nogiku-creator");
    await expect(await app.openNotificationSettings()).toBeVisible();

    const email = app.notificationChannel("email");
    await expect(email).toHaveCount(1);
    await expect(email.locator(".notif-channel__address")).not.toBeEmpty();
    await expect(app.notificationChannel("slack")).toHaveCount(0);

    await expect(email.locator("m3e-switch")).toHaveJSProperty("checked", false);
    await email.locator("m3e-switch").click();
    await expect(email.locator("m3e-switch")).toHaveJSProperty("checked", true);
    await app.closeDialog();
    await app.openNotificationSettings();
    await expect(app.notificationChannel("email").locator("m3e-switch")).toHaveJSProperty(
      "checked",
      true,
    );
  });

  test("テスト通知を送るとボタンが押せなくなり、ベルにテスト通知が届く", async ({ app }) => {
    await app.signInAs("mock-nogiku-creator");
    await app.openNotificationSettings();
    const send = app.sendTestNotificationButton();
    await expect(send).toHaveJSProperty("disabled", false);
    await send.click();
    await expect(send).toHaveJSProperty("disabled", true);
    await app.closeDialog();

    const rows = await app.notifications();
    await expect(rows.and(app.page.locator('[data-kind="test"]'))).toHaveCount(1);
  });
});
