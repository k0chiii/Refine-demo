import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 通知の受け取り方", () => {
  it("既定は内容を表示・止めなし。渡した項目だけ変わり、本人の設定だけが変わる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    expect(await cast.reviewer.as.query(api.notificationPrefs.get, {})).toEqual({
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
    expect(await cast.reviewer.as.query(api.notificationPrefs.get, {})).toEqual({
      showPreview: false,
      mutedCategories: ["mention", "deadline"],
      channels: [],
    });
    expect(await cast.creator.as.query(api.notificationPrefs.get, {})).toEqual({
      showPreview: true,
      mutedCategories: [],
      channels: [],
    });
  });

  it("知らない分類は保存しない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await expect(
      cast.reviewer.as.mutation(api.notificationPrefs.update, { mutedCategories: ["nope"] }),
    ).rejects.toEqual(code("notification_prefs_invalid"));
  });
});
