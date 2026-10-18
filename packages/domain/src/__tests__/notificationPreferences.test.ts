import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DomainError,
  isCategoryMuted,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KIND_CATEGORY,
  normalizeNotificationPrefs,
  notificationCategoryOf,
  validateNotificationPrefsPatch,
} from "../index.ts";

describe("通知の分類", () => {
  it("すべての種類が分類に入り、分類は決まった一覧のどれか", () => {
    for (const [kind, category] of Object.entries(NOTIFICATION_KIND_CATEGORY)) {
      expect(NOTIFICATION_CATEGORIES).toContain(category);
      expect(notificationCategoryOf(kind)).toBe(category);
    }
  });

  it("メンション・返信・割当・期限・ルールの提案に振り分け、知らない種類は「その他」", () => {
    expect(notificationCategoryOf("mentioned")).toBe("mention");
    expect(notificationCategoryOf("feedback_mentioned")).toBe("mention");
    expect(notificationCategoryOf("comment_posted")).toBe("reply");
    expect(notificationCategoryOf("feedback_posted")).toBe("reply");
    expect(notificationCategoryOf("review_assigned")).toBe("assignment");
    expect(notificationCategoryOf("check_requested")).toBe("assignment");
    expect(notificationCategoryOf("deadline_approaching")).toBe("deadline");
    expect(notificationCategoryOf("rule_proposed")).toBe("rule");
    expect(notificationCategoryOf("something_new")).toBe("other");
  });
});

describe("通知の受け取り方", () => {
  it("既定は内容を表示・止めている分類なし", () => {
    expect(normalizeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(DEFAULT_NOTIFICATION_PREFS.showPreview).toBe(true);
  });

  it("保存された分類は重複と知らないものを除き、決まった順にそろえる", () => {
    expect(
      normalizeNotificationPrefs({ mutedCategories: ["other", "mention", "mention", "x"] })
        .mutedCategories,
    ).toEqual(["mention", "other"]);
  });

  it("利用者が送った分類に知らないものがあれば受け付けない", () => {
    expect(() => validateNotificationPrefsPatch({ mutedCategories: ["mention", "x"] })).toThrow(
      DomainError,
    );
    expect(validateNotificationPrefsPatch({ showPreview: false })).toEqual({ showPreview: false });
    expect(validateNotificationPrefsPatch({})).toEqual({});
  });

  it("止めた分類の種類だけ止める", () => {
    const prefs = normalizeNotificationPrefs({ mutedCategories: ["reply"] });
    expect(isCategoryMuted(prefs, "comment_posted")).toBe(true);
    expect(isCategoryMuted(prefs, "mentioned")).toBe(false);
    expect(isCategoryMuted(prefs, "unknown_kind")).toBe(false);
    const other = normalizeNotificationPrefs({ mutedCategories: ["other"] });
    expect(isCategoryMuted(other, "unknown_kind")).toBe(true);
  });
});
