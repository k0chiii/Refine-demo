import { groupMentionToken } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { postComment, replyToThread, searchMentionGroups } from "../usecases/comments.ts";
import { deleteMemberGroup, listMemberGroups, saveMemberGroup } from "../usecases/groups.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("メンバーのグループ（管理）", () => {
  it("作ったグループを並び順で誰でも引ける。変更と削除は監査に残る", async () => {
    const ctx = createInMemoryContext();
    const a = await saveMemberGroup(ctx, principals.sysadmin, {
      name: "こうせいはん",
      memberIds: [principals.reviewer.userId],
    });
    const b = await saveMemberGroup(ctx, principals.sysadmin, { name: "こうほう", memberIds: [] });
    expect([a.order, b.order]).toEqual([1, 2]);
    // 並び順を省略した変更は今の並び順のまま
    await saveMemberGroup(ctx, principals.sysadmin, {
      id: a.id,
      name: "こうせい",
      memberIds: [principals.reviewer.userId, principals.approver.userId],
    });
    const list = await listMemberGroups(ctx, principals.creator);
    expect(list.map((g) => [g.name, g.order, g.memberIds.length])).toEqual([
      ["こうせい", 1, 2],
      ["こうほう", 2, 0],
    ]);
    expect(ctx.state.audit.filter((e) => e.entityType === "memberGroup")).toHaveLength(3);
    await deleteMemberGroup(ctx, principals.sysadmin, b.id);
    expect((await listMemberGroups(ctx, principals.creator)).map((g) => g.id)).toEqual([a.id]);
  });
  it("作る・変える・消すのは groups:manage を持つ人とシステム管理者。どちらでもない人は forbidden", async () => {
    const ctx = createInMemoryContext();
    const holder = { ...principals.manager, orgPermissions: ["groups:manage"] };
    const neither = { ...principals.creator, orgPermissions: ["works:create", "approvers:assign"] };
    const admin = { ...principals.sysadmin, orgPermissions: [] as string[] };

    const g = await saveMemberGroup(ctx, holder, { name: "こうせいはん", memberIds: [] });
    await saveMemberGroup(ctx, holder, { id: g.id, name: "こうせい", memberIds: [] });
    await expect(
      saveMemberGroup(ctx, neither, { name: "こうほう", memberIds: [] }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      saveMemberGroup(ctx, neither, { id: g.id, name: "x", memberIds: [] }),
    ).rejects.toThrow(code("forbidden"));
    await expect(deleteMemberGroup(ctx, neither, g.id)).rejects.toThrow(code("forbidden"));
    // 一覧は権限が無くても引ける
    expect((await listMemberGroups(ctx, neither)).map((x) => x.name)).toEqual(["こうせい"]);

    await deleteMemberGroup(ctx, holder, g.id);
    const h = await saveMemberGroup(ctx, admin, { name: "こうほう", memberIds: [] });
    await deleteMemberGroup(ctx, admin, h.id);
    expect(await listMemberGroups(ctx, neither)).toEqual([]);
  });
  it("委員の名簿にいない人は入れられない。知らないグループの変更は group_not_found", async () => {
    const ctx = createInMemoryContext();
    await expect(
      saveMemberGroup(ctx, principals.sysadmin, { name: "x", memberIds: ["nobody"] }),
    ).rejects.toThrow(code("group_invalid"));
    await expect(
      saveMemberGroup(ctx, principals.sysadmin, { id: "nope", name: "x", memberIds: [] }),
    ).rejects.toThrow(code("group_not_found"));
  });
});

describe("グループのメンション", () => {
  async function setup() {
    const ctx = createInMemoryContext();
    // 非公開の制作物: 校正者は ACL で見られる。stranger はグループにいても見られない
    const work = await seedWork(ctx);
    const revision = await submitRevision(ctx, work.id, { deadlineInHours: 24 });
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    const group = await saveMemberGroup(ctx, principals.sysadmin, {
      name: "こうせいはん",
      memberIds: [
        principals.reviewer.userId,
        principals.approver.userId,
        principals.stranger.userId,
      ],
    });
    return { ctx, work, revision, group };
  }
  const kinds = (ctx: ReturnType<typeof createInMemoryContext>, userId: string) =>
    ctx.state.notifications
      .all()
      .filter((n) => n.recipientId === userId && n.threadId)
      .map((n) => n.kind);

  it("「@グループ名」で所属する委員全員に知らせる（書いた本人は外す）（105A）", async () => {
    const { ctx, revision, group } = await setup();
    const thread = await postComment(ctx, principals.reviewer, {
      revisionId: revision.id,
      body: "@こうせいはん 確認お願いします",
      kind: "question",
      severity: "info",
      mentions: [groupMentionToken(group.id)],
    });
    expect((thread.mentions ?? []).sort()).toEqual(
      [principals.approver.userId, principals.stranger.userId].sort(),
    );
    expect(thread.mentionGroupIds).toEqual([group.id]);
    expect(kinds(ctx, principals.approver.userId)).toEqual(["mentioned"]);
    expect(kinds(ctx, principals.stranger.userId)).toEqual(["mentioned"]);
    expect(kinds(ctx, principals.reviewer.userId)).toEqual([]);

    // 返信でも同じ。人とグループを一緒にメンションしても、知らせるのは 1 回
    await replyToThread(ctx, principals.creator, {
      threadId: thread.id,
      body: "@こうせいはん @こまば こうりょう 直しました",
      mentions: [groupMentionToken(group.id), principals.approver.userId],
    });
    const replied = (await ctx.threads.listEvents(thread.id)).find(
      (e) => e.eventType === "replied",
    );
    expect(replied?.payload).toMatchObject({
      mentions: [
        principals.approver.userId,
        principals.reviewer.userId,
        principals.stranger.userId,
      ],
      mentionGroupIds: [group.id],
    });
    expect(kinds(ctx, principals.approver.userId)).toEqual(["mentioned", "mentioned"]);
  });

  it("知らないグループは拒否。候補は名前で探し、知らせる人数を添える（見られる人だけが引ける）", async () => {
    const { ctx, work, revision, group } = await setup();
    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: revision.id,
        body: "@x",
        kind: "question",
        severity: "info",
        mentions: [groupMentionToken("nope")],
      }),
    ).rejects.toThrow(code("mention_not_allowed"));
    expect(
      await searchMentionGroups(ctx, principals.creator, { workId: work.id, text: "コウセイ" }),
    ).toEqual([{ id: group.id, name: "こうせいはん", memberCount: 3 }]);
    expect(
      await searchMentionGroups(ctx, principals.creator, { workId: work.id, text: "ほか" }),
    ).toEqual([]);
    expect(
      await searchMentionGroups(ctx, principals.stranger, { workId: work.id, text: "" }),
    ).toEqual([{ id: group.id, name: "こうせいはん", memberCount: 2 }]);
  });
});
