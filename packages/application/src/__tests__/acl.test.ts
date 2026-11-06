import { isGrantActive } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, listWorkPermissions, revokeWorkPermission } from "../usecases/acl.ts";
import { postComment } from "../usecases/comments.ts";
import { saveTeam } from "../usecases/teams.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("作品単位の個人 ACL（A-01, A-11, A-19, A-20）", () => {
  it("A-01: 無い作品 ID は forbidden（存在を漏らさない）。105A: 委員はすべての制作物を見られる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, "work_does_not_exist", "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("通常の作品はサインインした委員なら誰でも見られ、コメントも書ける。編集・校正への参加は職責か ACL", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "comment.post"),
    ).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "review.participate"),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.edit"),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, "work_does_not_exist", "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("関係者・担当所属も閲覧とコメントまで。校正への参加は review 以上の ACL か職責", async () => {
    const ctx = createInMemoryContext();
    const bureau = await saveTeam(ctx, principals.sysadmin, { name: "広報局", kind: "bureau" });
    const design = await saveTeam(ctx, principals.sysadmin, {
      name: "デザイン担当",
      kind: "team",
      parentId: bureau.id,
      memberIds: [principals.reviewer.userId],
    });
    const work = await seedWork(ctx, {
      stakeholderIds: [principals.stranger.userId],
      productionTeamIds: [design.id],
    });
    const member = { ...principals.reviewer, teamIds: [design.id] };
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await expect(loadAuthorizedWork(ctx, member, work.id, "work.view")).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.reviewer, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await saveTeam(ctx, principals.sysadmin, { ...design, memberIds: [] });
    await expect(
      loadAuthorizedWork(ctx, principals.reviewer, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await expect(loadAuthorizedWork(ctx, member, work.id, "comment.post")).resolves.toBeTruthy();
    await expect(loadAuthorizedWork(ctx, member, work.id, "review.participate")).rejects.toThrow(
      code("forbidden"),
    );
  });

  it("A-19: 管理者が校正以上の ACL を追加/除外でき、一般ユーザーは ACL を変更できない。履歴が残る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const viewer = {
      userId: "u_viewer",
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: ["*"],
    };
    ctx.state.members.add(viewer.userId);

    await expect(
      grantWorkPermission(ctx, principals.manager, {
        workId: work.id,
        userIds: [viewer.userId],
        permission: "review",
      }),
    ).rejects.toThrow(code("acl_requires_system_admin"));

    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [viewer.userId],
      permission: "review",
    });
    await expect(
      loadAuthorizedWork(ctx, viewer, work.id, "review.participate"),
    ).resolves.toBeTruthy();

    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [viewer.userId],
      permission: "review",
    });
    const history = await listWorkPermissions(ctx, principals.sysadmin, work.id);
    expect(history.filter(isGrantActive)).toHaveLength(1);

    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userId: viewer.userId,
    });
    await expect(loadAuthorizedWork(ctx, viewer, work.id, "work.view")).resolves.toBeTruthy();
    await expect(loadAuthorizedWork(ctx, viewer, work.id, "review.participate")).rejects.toThrow(
      code("forbidden"),
    );
  });

  it("A-11: 校正者の ACL 解除後も閲覧とコメントは可。校正への参加だけ不可", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const rev = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    await postComment(ctx, principals.reviewer, {
      revisionId: rev.id,
      body: "a",
      kind: "question",
      severity: "info",
    });
    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userId: principals.reviewer.userId,
    });
    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: rev.id,
        body: "b",
        kind: "question",
        severity: "info",
      }),
    ).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.reviewer, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.reviewer, work.id, "review.participate"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("付与は人だけ。知らない人が一人でもいれば、誰の行も書かない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      grantWorkPermission(ctx, principals.sysadmin, {
        workId: work.id,
        userIds: [principals.reviewer.userId, "missing-user"],
        permission: "review",
      }),
    ).rejects.toThrow(code("acl_invalid"));
    expect(ctx.state.grants).toEqual([]);
  });
});
