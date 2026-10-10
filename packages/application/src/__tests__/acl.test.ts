import { isGrantActive } from "@mf100/domain";
import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission, listWorkPermissions, revokeWorkPermission } from "../usecases/acl.ts";
import { postComment } from "../usecases/comments.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, submitRevision } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });

describe("作品単位の個人 ACL（A-01, A-11, A-19, A-20）", () => {
  it("A-01: 権限を持たないユーザーが作品 ID を直接指定しても forbidden（存在を漏らさない）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, work.id, "work.view"),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      loadAuthorizedWork(ctx, principals.stranger, "work_does_not_exist", "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });

  it("A-19: 管理者が閲覧者を追加/除外でき、一般ユーザーは ACL を変更できない。履歴が残る", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const viewer = { userId: "u_viewer", isSystemAdmin: false, groupIds: [] };

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

  it("A-11: 校正者の ACL 解除後は閲覧も投稿もできない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
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

  it("システム管理者であっても ACL/職責の無い作品は閲覧できない（§7.2）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await expect(
      loadAuthorizedWork(ctx, principals.sysadmin, work.id, "work.view"),
    ).rejects.toThrow(code("forbidden"));
  });
});
