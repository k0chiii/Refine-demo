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
  it("A-01: 非公開の作品は、権限を持たないユーザーが作品 ID を直接指定しても forbidden（存在を漏らさない）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { confidentiality: "restricted" });
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.view"),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, "work_does_not_exist", "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("通常の作品はサインインした委員なら誰でも見られる（利用者決定 2026-10-17）。見るだけで、投稿・編集はできない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.sysadmin, work.id, "work.view"),
    ).resolves.toBeTruthy();
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "comment.post"),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.edit"),
    ).rejects.toThrow(code("forbidden"));
    // 無い作品は見られる人でも forbidden（存在を漏らさない）
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, "work_does_not_exist", "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("非公開の作品でも、関係者と、主管担当・制作担当・関係担当に所属する人は見られる（自動で付く。ACL は要らない）", async () => {
    const ctx = createInMemoryContext();
    const bureau = await saveTeam(ctx, principals.sysadmin, { name: "広報局", kind: "bureau" });
    const design = await saveTeam(ctx, principals.sysadmin, {
      name: "デザイン担当",
      kind: "team",
      parentId: bureau.id,
      memberIds: [principals.reviewer.userId],
    });
    const work = await seedWork(ctx, {
      confidentiality: "restricted",
      stakeholderIds: [principals.stranger.userId],
      productionTeamIds: [design.id],
    });
    // 関係者
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.view"),
    ).resolves.toBeTruthy();
    // 担当の所属（主体に所属を添えてあればそれを使う）
    const member = { ...principals.reviewer, teamIds: [design.id] };
    await expect(loadAuthorizedWork(ctx, member, work.id, "work.view")).resolves.toBeTruthy();
    // 所属を添えていない主体でも、閲覧の判定で担当の一覧を読んで通す（所属は要るときだけ読む。§60）
    await expect(
      loadAuthorizedWork(ctx, principals.reviewer, work.id, "work.view"),
    ).resolves.toBeTruthy();
    // 所属を外すと見られない
    await saveTeam(ctx, principals.sysadmin, { ...design, memberIds: [] });
    await expect(
      loadAuthorizedWork(ctx, principals.reviewer, work.id, "work.view"),
    ).rejects.toThrow(code("forbidden"));
    // 閲覧だけ
    await expect(loadAuthorizedWork(ctx, member, work.id, "comment.post")).rejects.toThrow(
      code("forbidden"),
    );
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "revision.submit"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("A-19: 管理者が閲覧者を追加/除外でき、一般ユーザーは ACL を変更できない。履歴が残る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { confidentiality: "restricted" });
    const viewer = {
      userId: "u_viewer",
      isSystemAdmin: false,
      groupIds: [],
      orgPermissions: ["*"],
    };

    await expect(
      grantWorkPermission(ctx, principals.manager, {
        workId: work.id,
        principalType: "user",
        principalId: viewer.userId,
        permission: "view",
      }),
    ).rejects.toThrow(code("acl_requires_system_admin"));

    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: viewer.userId,
      permission: "view",
    });
    await expect(loadAuthorizedWork(ctx, viewer, work.id, "work.view")).resolves.toBeTruthy();

    // レベル変更は旧付与の取消＋新付与として履歴に残る
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: viewer.userId,
      permission: "review",
    });
    const history = await listWorkPermissions(ctx, principals.sysadmin, work.id);
    expect(history.length).toBe(2);
    expect(history.filter(isGrantActive)).toHaveLength(1);
    expect(history[0]).toMatchObject({ permission: "view", revokedBy: principals.sysadmin.userId });

    const revoked = await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: viewer.userId,
    });
    expect(revoked).toBe(1);
    await expect(loadAuthorizedWork(ctx, viewer, work.id, "work.view")).rejects.toThrow(
      code("forbidden"),
    );
    expect(
      ctx.state.audit.filter((a) => a.entityType === "workPermission").map((a) => a.operation),
    ).toEqual(["grant", "revoke", "grant", "revoke"]);
  });

  it("A-11: 校正者の ACL 解除後は閲覧も投稿もできない（非公開の作品）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { confidentiality: "restricted" });
    const rev = await submitRevision(ctx, work.id);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
      permission: "review",
    });
    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: rev.id,
        body: "a",
        kind: "question",
        severity: "info",
      }),
    ).resolves.toBeTruthy();
    await revokeWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      principalType: "user",
      principalId: principals.reviewer.userId,
    });
    await expect(
      postComment(ctx, principals.reviewer, {
        revisionId: rev.id,
        body: "b",
        kind: "question",
        severity: "info",
      }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      loadAuthorizedWork(ctx, principals.reviewer, work.id, "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("A-20: グループ主体は MVP では付与できない（将来拡張点）。個人 ACL だけで運用できる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      grantWorkPermission(ctx, principals.sysadmin, {
        workId: work.id,
        principalType: "group",
        principalId: "nogiku-group",
        permission: "view",
      }),
    ).rejects.toThrow(code("acl_group_principal_not_enabled"));
  });

  it("システム管理者であっても ACL/職責の無い非公開の作品は閲覧できない（§7.2）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { confidentiality: "restricted" });
    await expect(
      loadAuthorizedWork(ctx, principals.sysadmin, work.id, "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });
});
