import { DomainError } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, revokeWorkPermission } from "../usecases/acl.ts";
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
      principalType: "user",
      principalId: principals.stranger.userId,
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
      title: "校了を取り消しました",
      body: "『夏のポスター』",
      url: `/works/${work.id}`,
      badge: 1,
    });
    expect(JSON.stringify(plan?.payload)).not.toContain("誤字");

    // 送る前に閲覧権限が外れたら（非公開になり、ACL も外れた）、伏せた内容にする
    await ctx.works.update({
      ...(await ctx.works.findById(work.id))!,
      confidentiality: "restricted",
    });
    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.stranger.userId,
    });
    const hidden = await planPushDelivery(ctx, n.id);
    expect(JSON.stringify(hidden?.payload)).not.toContain("夏のポスター");
    expect(hidden?.payload.url).toBe("/");
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
    expect(ctx.state.pushSubscriptions.get(s.id)).toMatchObject({
      failureCount: 0,
      lastSuccessAt: ctx.clock.now(),
    });
    expect(await recordPushResult(ctx, s.id, 410)).toBe("deleted");
    expect(await recordPushResult(ctx, s.id, 201)).toBe("missing");
  });
});
