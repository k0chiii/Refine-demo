import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DomainError,
  isCategoryMuted,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KIND_CATEGORY,
  normalizeNotificationPrefs,
  notificationCategoryOf,
  slackAddressOf,
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

  it("既定ではメール・Slack をオンにしない", () => {
    expect(normalizeNotificationPrefs(null).channels).toEqual([]);
    expect(normalizeNotificationPrefs({ showPreview: false }).channels).toEqual([]);
  });

  it("保存された経路は重複と知らないものを除き、決まった順にそろえる", () => {
    expect(
      normalizeNotificationPrefs({ channels: ["slack", "push", "email", "slack", "sms"] }).channels,
    ).toEqual(["email", "slack"]);
  });

  it("利用者が送った経路は決まった順にそろえ、知らないものがあれば受け付けない", () => {
    expect(validateNotificationPrefsPatch({ channels: ["slack", "email", "slack"] })).toEqual({
      channels: ["email", "slack"],
    });
    expect(validateNotificationPrefsPatch({ channels: [] })).toEqual({ channels: [] });
    expect(validateNotificationPrefsPatch({ showPreview: true, channels: ["slack"] })).toEqual({
      showPreview: true,
      channels: ["slack"],
    });
    for (const channels of [["email", "sms"], ["push"]])
      expect(() => validateNotificationPrefsPatch({ channels })).toThrow(
        expect.objectContaining({ code: "notification_prefs_invalid" }),
      );
  });

  it("Slack のワークスペースは既定で選んでおらず、保存された ID は前後の空白を除いて残す", () => {
    expect(normalizeNotificationPrefs(null)).not.toHaveProperty("slackWorkspaceId");
    expect(normalizeNotificationPrefs({ slackWorkspaceId: " ws1 " }).slackWorkspaceId).toBe("ws1");
    for (const slackWorkspaceId of ["", "  ", null])
      expect(normalizeNotificationPrefs({ slackWorkspaceId })).not.toHaveProperty(
        "slackWorkspaceId",
      );
  });

  it("利用者が送ったワークスペースは ID なら残し、null は選択を外す。空は受け付けない", () => {
    expect(validateNotificationPrefsPatch({ slackWorkspaceId: " ws1 " })).toEqual({
      slackWorkspaceId: "ws1",
    });
    expect(validateNotificationPrefsPatch({ slackWorkspaceId: null })).toEqual({
      slackWorkspaceId: null,
    });
    expect(() => validateNotificationPrefsPatch({ slackWorkspaceId: " " })).toThrow(
      expect.objectContaining({
        code: "notification_prefs_invalid",
        details: { field: "slackWorkspaceId" },
      }),
    );
    const selected = normalizeNotificationPrefs({ channels: ["slack"], slackWorkspaceId: "ws1" });
    expect(
      normalizeNotificationPrefs({
        ...selected,
        ...validateNotificationPrefsPatch({ slackWorkspaceId: null }),
      }),
    ).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, channels: ["slack"] });
  });

  it("Slack のメールアドレスは既定で書いておらず、保存されたものは残す", () => {
    expect(normalizeNotificationPrefs(null)).not.toHaveProperty("slackEmail");
    expect(normalizeNotificationPrefs({ slackEmail: "a@b.jp" }).slackEmail).toBe("a@b.jp");
    for (const slackEmail of ["", "  ", null])
      expect(normalizeNotificationPrefs({ slackEmail })).not.toHaveProperty("slackEmail");
  });

  it("利用者が送った Slack のメールアドレスはそろえて残し、null・空は消す。形が違えば受け付けない", () => {
    expect(validateNotificationPrefsPatch({ slackEmail: " Kenta@Example-Org.JP " })).toEqual({
      slackEmail: "kenta@example-org.jp",
    });
    for (const slackEmail of [null, "", "  "])
      expect(validateNotificationPrefsPatch({ slackEmail })).toEqual({ slackEmail: null });
    expect(() => validateNotificationPrefsPatch({ slackEmail: "kenta" })).toThrow(
      expect.objectContaining({
        code: "notification_prefs_invalid",
        details: { field: "slackEmail" },
      }),
    );
  });

  it("Slack で引くアドレスは、書いた Slack のメールアドレス、無ければ Nogiku のアドレス", () => {
    const nogiku = "7787946800@g.ecc.u-tokyo.ac.jp";
    expect(slackAddressOf({ slackEmail: "kenta@example-org.jp" }, nogiku)).toBe(
      "kenta@example-org.jp",
    );
    expect(slackAddressOf({ slackEmail: "kenta@example-org.jp" }, null)).toBe(
      "kenta@example-org.jp",
    );
    expect(slackAddressOf({}, nogiku)).toBe(nogiku);
    expect(slackAddressOf({}, null)).toBeNull();
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
