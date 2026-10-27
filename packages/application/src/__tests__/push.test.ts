import {
  DomainError,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KIND_CATEGORY,
  type NotificationCategory,
  notificationCategoryOf,
} from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, revokeWorkPermission } from "../usecases/acl.ts";
import type { NotificationKind } from "../ports.ts";
import { getNotificationPrefs, updateNotificationPrefs } from "../usecases/notificationPrefs.ts";
import { notify } from "../usecases/notifications.ts";
import {
  isPushSubscribed,
  planPushDelivery,
  recordPushResult,
  subscribePush,
  unsubscribePush,
} from "../usecases/push.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork } from "../testing/scenario.ts";

const sub = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  p256dh: `B${"A".repeat(86)}`,
  auth: "A".repeat(22),
});

describe("端末への通知（Web Push）", () => {
  it("同じ端末をほかの人が登録し直すと付け替わる（前の人の通知を出さない）", async () => {
    const ctx = createInMemoryContext();
    await subscribePush(ctx, principals.reviewer, { ...sub(), device: "iPhone" });
    await subscribePush(ctx, principals.creator, sub());
    expect(ctx.state.pushSubscriptions.all()).toHaveLength(1);
    expect(await isPushSubscribed(ctx, principals.reviewer, sub().endpoint)).toBe(false);
    expect(await isPushSubscribed(ctx, principals.creator, sub().endpoint)).toBe(true);
    // 他人の購読は解除できない
    expect(await unsubscribePush(ctx, principals.reviewer, sub().endpoint)).toBe(false);
    expect(await unsubscribePush(ctx, principals.creator, sub().endpoint)).toBe(true);
    expect(ctx.state.pushSubscriptions.all()).toHaveLength(0);
  });

  it("知らない宛先は登録しない", async () => {
    const ctx = createInMemoryContext();
    await expect(
      subscribePush(ctx, principals.reviewer, { ...sub(), endpoint: "https://example.com/push" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("受信者の端末ごとに、題名と制作物名だけを送る計画を作る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { title: "夏のポスター" });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.stranger.userId],
      permission: "view",
    });
    await subscribePush(ctx, principals.stranger, sub(1));
    await subscribePush(ctx, principals.stranger, sub(2));
    await notify(ctx, [principals.stranger.userId], null, {
      kind: "work_reopened",
      title: "校了を取り消しました",
      body: "『夏のポスター』・理由: 誤字（確認観点など）",
      workId: work.id,
    });
    const n = ctx.state.notifications.all()[0]!;
    const plan = await planPushDelivery(ctx, n.id);
    expect(plan?.targets).toHaveLength(2);
    expect(plan?.payload).toMatchObject({
      url: `/works/${work.id}`,
      id: n.id,
      tag: work.id,
      badge: 1,
      createdAt: n.createdAt,
    });
    expect(plan?.payload.title).toContain("夏のポスター");
    expect(JSON.stringify(plan?.payload)).not.toContain("誤字");

    // 送る前に閲覧権限が外れたら（非公開になり、ACL も外れた）、伏せた内容にする
    await ctx.works.update({
      ...(await ctx.works.findById(work.id))!,
      confidentiality: "restricted",
    });
    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userId: principals.stranger.userId,
    });
    const hidden = await planPushDelivery(ctx, n.id);
    expect(JSON.stringify(hidden?.payload)).not.toContain("夏のポスター");
    expect(hidden?.payload.url).toBe("/");
  });

  describe("送り主・抜粋・設定", () => {
    async function setup() {
      const ctx = createInMemoryContext();
      ctx.state.names.set(principals.reviewer.userId, "本郷 校正");
      const work = await seedWork(ctx, { title: "夏のポスター" });
      await grantWorkPermission(ctx, principals.sysadmin, {
        workId: work.id,
        userIds: [principals.stranger.userId],
        permission: "view",
      });
      await subscribePush(ctx, principals.stranger, sub());
      const post = async (kind: "comment_posted" | "review_assigned" = "comment_posted") => {
        await notify(ctx, [principals.stranger.userId], principals.reviewer.userId, {
          kind,
          title: "題名",
          body: "『夏のポスター』・本郷 校正さん: 相談です",
          preview: "相談です",
          workId: work.id,
          threadId: "thr-1",
        });
        return ctx.state.notifications.all().at(-1)!;
      };
      return { ctx, work, post };
    }

    it("送り主の名前と抜粋を載せ、同じスレッドの通知は同じ印でまとまる", async () => {
      const { ctx, post } = await setup();
      const a = await post();
      const b = await post();
      expect(a.actorId).toBe(principals.reviewer.userId);
      const pa = (await planPushDelivery(ctx, a.id))!.payload;
      const pb = (await planPushDelivery(ctx, b.id))!.payload;
      expect(pa.body).toContain("本郷 校正");
      expect(pa.body).toContain("相談です");
      expect(pa.tag).toBe("thr-1");
      expect(pb.tag).toBe(pa.tag);
      expect(pb.id).toBe(b.id);
    });

    it("「通知に内容を表示」を切ると、送り主と抜粋を載せない（アプリ内の通知は残る）", async () => {
      const { ctx, post } = await setup();
      const n = await post();
      await updateNotificationPrefs(ctx, principals.stranger, { showPreview: false });
      const payload = (await planPushDelivery(ctx, n.id))!.payload;
      expect(JSON.stringify(payload)).not.toMatch(/本郷|相談です/);
      expect(ctx.state.notifications.get(n.id)?.preview).toBe("相談です");
      // ポリシー側で止めても同じ
      await updateNotificationPrefs(ctx, principals.stranger, { showPreview: true });
      const byPolicy = (await planPushDelivery(ctx, n.id, {
        showWorkTitle: true,
        showPreview: false,
      }))!;
      expect(JSON.stringify(byPolicy.payload)).not.toMatch(/本郷|相談です/);
    });

    it("止めた分類の通知は端末に送らない。ほかの分類は送る", async () => {
      const { ctx, post } = await setup();
      const comment = await post("comment_posted");
      const assigned = await post("review_assigned");
      await updateNotificationPrefs(ctx, principals.stranger, { mutedCategories: ["reply"] });
      expect(await planPushDelivery(ctx, comment.id)).toBeNull();
      expect(await planPushDelivery(ctx, assigned.id)).not.toBeNull();
      // アプリ内の通知は消えない
      expect(ctx.state.notifications.get(comment.id)).toBeDefined();
      await updateNotificationPrefs(ctx, principals.stranger, { mutedCategories: [] });
      expect(await planPushDelivery(ctx, comment.id)).not.toBeNull();
    });

    it("非公開の制作物と、見られなくなった制作物は、名前・送り主・抜粋を載せない", async () => {
      const { ctx, work, post } = await setup();
      const n = await post();
      await ctx.works.update({
        ...(await ctx.works.findById(work.id))!,
        confidentiality: "restricted",
      });
      // 閲覧 ACL があって見られる非公開の制作物
      const restricted = (await planPushDelivery(ctx, n.id))!.payload;
      expect(JSON.stringify(restricted)).not.toMatch(/夏のポスター|本郷|相談です/);
      // ACL が外れて見られなくなった
      await revokeWorkPermission(ctx, principals.sysadmin, {
        workId: work.id,
        userId: principals.stranger.userId,
      });
      const hidden = (await planPushDelivery(ctx, n.id))!.payload;
      expect(JSON.stringify(hidden)).not.toMatch(/夏のポスター|本郷|相談です|thr-1/);
      expect(hidden.url).toBe("/");
      expect(hidden.tag).toBe(n.id);
    });

    it("見られない人の通知には、送り主も抜粋も保存しない", async () => {
      const ctx = createInMemoryContext();
      ctx.state.names.set(principals.reviewer.userId, "本郷 校正");
      const work = await seedWork(ctx, { title: "極秘" });
      await ctx.works.update({ ...work, confidentiality: "restricted" });
      await notify(ctx, [principals.stranger.userId], principals.reviewer.userId, {
        kind: "comment_posted",
        title: "t",
        body: "b",
        preview: "相談です",
        workId: work.id,
      });
      const n = ctx.state.notifications.all()[0]!;
      expect(n.actorId).toBeUndefined();
      expect(n.preview).toBeUndefined();
    });
  });

  describe("通知の受け取り方（利用者ごと）", () => {
    it("既定は内容を表示・止めなし。渡した項目だけ変わり、本人の設定だけを読み書きする", async () => {
      const ctx = createInMemoryContext();
      expect(await getNotificationPrefs(ctx, principals.reviewer)).toEqual({
        showPreview: true,
        mutedCategories: [],
      });
      await updateNotificationPrefs(ctx, principals.reviewer, {
        mutedCategories: ["rule", "mention"],
      });
      const after = await updateNotificationPrefs(ctx, principals.reviewer, { showPreview: false });
      expect(after).toEqual({ showPreview: false, mutedCategories: ["mention", "rule"] });
      expect(await getNotificationPrefs(ctx, principals.creator)).toEqual({
        showPreview: true,
        mutedCategories: [],
      });
    });

    it("知らない分類は保存しない", async () => {
      const ctx = createInMemoryContext();
      await expect(
        updateNotificationPrefs(ctx, principals.reviewer, { mutedCategories: ["nope"] }),
      ).rejects.toBeInstanceOf(DomainError);
      expect(ctx.state.notificationPrefs.size).toBe(0);
    });

    it("notify に渡す通知の種類はすべて分類に入っている", () => {
      // NotificationKind に種類を足したら、domain の NOTIFICATION_KIND_CATEGORY にも足さないと型が通らない
      const categories: Record<NotificationKind, NotificationCategory> = NOTIFICATION_KIND_CATEGORY;
      for (const kind of Object.keys(categories)) {
        expect(NOTIFICATION_KIND_CATEGORY).toHaveProperty(kind);
        expect(NOTIFICATION_CATEGORIES).toContain(notificationCategoryOf(kind));
      }
      expect(Object.keys(categories).length).toBeGreaterThan(0);
    });
  });

  it("購読が無い・既読の通知は送らない", async () => {
    const ctx = createInMemoryContext();
    await notify(ctx, [principals.reviewer.userId], null, {
      kind: "rule_proposed",
      title: "t",
      body: "b",
    });
    const n = ctx.state.notifications.all()[0]!;
    expect(await planPushDelivery(ctx, n.id)).toBeNull();
    await subscribePush(ctx, principals.reviewer, sub());
    expect(await planPushDelivery(ctx, n.id)).not.toBeNull();
    ctx.state.notifications.put({ ...n, readAt: ctx.clock.now() });
    expect(await planPushDelivery(ctx, n.id)).toBeNull();
  });

  it("宛先が無くなったら購読を消し、成功で失敗回数を戻す", async () => {
    const ctx = createInMemoryContext();
    const s = await subscribePush(ctx, principals.reviewer, sub());
    expect(await recordPushResult(ctx, s.id, 500)).toBe("kept");
    expect(ctx.state.pushSubscriptions.get(s.id)?.failureCount).toBe(1);
    expect(await recordPushResult(ctx, s.id, 201)).toBe("kept");
    expect(ctx.state.pushSubscriptions.get(s.id)?.failureCount).toBe(0);
    expect(await recordPushResult(ctx, s.id, 410)).toBe("deleted");
    expect(await recordPushResult(ctx, s.id, 201)).toBe("missing");
  });

  it("失敗回数が変わらない成功は購読を書かない（同じ端末への配信が並んでも書き込みがぶつからない）", async () => {
    const ctx = createInMemoryContext();
    const s = await subscribePush(ctx, principals.reviewer, sub());
    const writes: number[] = [];
    const update = ctx.pushSubscriptions.update.bind(ctx.pushSubscriptions);
    ctx.pushSubscriptions.update = async (next) => {
      writes.push(next.failureCount);
      await update(next);
    };
    const before = ctx.state.pushSubscriptions.get(s.id);
    expect(await recordPushResult(ctx, s.id, 201)).toBe("kept");
    expect(writes).toEqual([]);
    expect(ctx.state.pushSubscriptions.get(s.id)).toEqual(before);

    expect(await recordPushResult(ctx, s.id, 503)).toBe("kept");
    expect(await recordPushResult(ctx, s.id, 201)).toBe("kept");
    expect(writes).toEqual([1, 0]);
    expect(ctx.state.pushSubscriptions.get(s.id)?.failureCount).toBe(0);
  });
});
