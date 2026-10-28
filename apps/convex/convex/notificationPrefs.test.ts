import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Convex 統合: 通知の受け取り方", () => {
  it("既定は内容を表示・止めなし。渡した項目だけ変わり、本人の設定だけが変わる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.notificationPrefs.get, {})).toMatchObject({
      showPreview: true,
      mutedCategories: [],
      channels: [],
    });
    await cast.reviewer.as.mutation(api.notificationPrefs.update, {
      mutedCategories: ["deadline", "mention"],
    });
    expect(
      await cast.reviewer.as.mutation(api.notificationPrefs.update, { showPreview: false }),
    ).toEqual({ showPreview: false, mutedCategories: ["mention", "deadline"], channels: [] });
    expect(await cast.reviewer.as.query(api.notificationPrefs.get, {})).toMatchObject({
      showPreview: false,
      mutedCategories: ["mention", "deadline"],
      channels: [],
    });
    expect(await cast.creator.as.query(api.notificationPrefs.get, {})).toMatchObject({
      showPreview: true,
      mutedCategories: [],
      channels: [],
    });
  });

  it("届け先: 秘密の揃った経路だけ使える。登録メールアドレスを出し、送れないアドレスなら no_address", async () => {
    // Slack をオンにすると引きに行く予約ができる。裏で走らせない
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const t = createHarness();
    const cast = await createCast(t);
    const mock = "reviewer@example.invalid";
    expect((await cast.reviewer.as.query(api.notificationPrefs.get, {})).destinations).toEqual({
      email: { available: false, on: false, address: mock, status: "no_address" },
      slack: { available: false, on: false, address: mock, status: "no_address" },
    });

    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NOTIFY_EMAIL_FROM", "MF100 <notify@example-org.jp>");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-test-token");
    const address = "reviewer@example-org.jp";
    await t.run((ctx) => ctx.db.patch(cast.reviewer.id, { email: address }));
    await cast.reviewer.as.mutation(api.notificationPrefs.update, { channels: ["slack", "email"] });
    const settings = await cast.reviewer.as.query(api.notificationPrefs.get, {});
    expect(settings.channels).toEqual(["email", "slack"]);
    expect(settings.destinations).toEqual({
      email: { available: true, on: true, address, status: "ready" },
      slack: { available: true, on: true, address, status: "unresolved" },
    });
    // 他の人の届け先は変わらない
    expect((await cast.creator.as.query(api.notificationPrefs.get, {})).destinations.email).toEqual(
      { available: true, on: false, address: "creator@example.invalid", status: "no_address" },
    );
  });

  it("知らない分類は保存しない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await expect(
      cast.reviewer.as.mutation(api.notificationPrefs.update, { mutedCategories: ["nope"] }),
    ).rejects.toEqual(code("notification_prefs_invalid"));
  });
});
