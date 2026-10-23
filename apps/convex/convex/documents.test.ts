import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { describe, expect, it } from "vite-plus/test";
import { createCast, createHarness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });
const doc = (t: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
  });

describe("Convex 統合: 文章の下書き", () => {
  it("制作者が保存し、校正者は読めるが書けない。権限のない人には存在も返さない。古い版番号は拒否", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "あいさつ文",
      purpose: "来場者向け",
      category: "文章",
      mediaType: "document",
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
      confidentiality: "restricted",
    })) as Id<"works">;
    await cast.admin.as.mutation(api.acl.grant, {
      workId,
      userIds: [cast.reviewer.id],
      permission: "review",
    });

    expect(await cast.creator.as.query(api.documents.get, { workId })).toEqual({
      draft: null,
      canEdit: true,
      collaborative: false,
    });
    const saved = await cast.creator.as.mutation(api.documents.save, {
      workId,
      title: "五月祭のごあいさつ",
      content: doc("皆さま"),
      text: "皆さま",
      baseVersion: 0,
    });
    expect(saved.version).toBe(1);

    const seen = await cast.reviewer.as.query(api.documents.get, { workId });
    expect(seen.canEdit).toBe(false);
    expect(seen.draft).toMatchObject({ title: "五月祭のごあいさつ", text: "皆さま", version: 1 });
    expect(seen.draft?.updatedBy?.id).toBe(cast.creator.id);
    await expect(
      cast.reviewer.as.mutation(api.documents.save, {
        workId,
        title: "x",
        content: doc("x"),
        text: "x",
        baseVersion: 1,
      }),
    ).rejects.toThrow(code("forbidden"));
    await expect(cast.stranger.as.query(api.documents.get, { workId })).rejects.toThrow(
      code("forbidden"),
    );
    await expect(
      cast.creator.as.mutation(api.documents.save, {
        workId,
        title: "t",
        content: doc("y"),
        text: "y",
        baseVersion: 0,
      }),
    ).rejects.toThrow(code("version_conflict"));
    await expect(
      cast.creator.as.mutation(api.documents.save, {
        workId,
        title: "t",
        content: "not json",
        text: "y",
        baseVersion: 1,
      }),
    ).rejects.toThrow(code("document_invalid"));
  });
});

describe("Convex 統合: エディタの入口", () => {
  it("書ける担当の制作物だけが下書きの要約つきで出る。校正だけの人・関係ない人には出ない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const create = (title: string) =>
      cast.manager.as.mutation(api.works.create, {
        title,
        purpose: "来場者向け",
        category: "文章",
        mediaType: "document",
        year: 100,
        creatorIds: [cast.creator.id],
        approverId: cast.approver.id,
        confidentiality: "restricted",
      }) as Promise<Id<"works">>;
    const a = await create("あいさつ文");
    const b = await create("会場案内");
    await cast.admin.as.mutation(api.acl.grant, {
      workId: a,
      userIds: [cast.reviewer.id],
      permission: "review",
    });
    await cast.creator.as.mutation(api.documents.save, {
      workId: b,
      title: "会場案内の文案",
      content: doc("本郷キャンパス"),
      text: "本郷キャンパス",
      baseVersion: 0,
    });

    const mine = await cast.creator.as.query(api.documents.writable, {});
    expect(mine.map((w) => w.title)).toEqual(["会場案内", "あいさつ文"]);
    expect(mine[0]!.draft).toMatchObject({ title: "会場案内の文案", chars: 7 });
    expect(mine[0]!.draft?.updatedBy?.id).toBe(cast.creator.id);
    expect(mine[0]).not.toHaveProperty("draft.content");
    expect(await cast.reviewer.as.query(api.documents.writable, {})).toEqual([]);
    expect(await cast.stranger.as.query(api.documents.writable, {})).toEqual([]);
  });
});

describe("Convex 統合: SNS のアカウント（本体の設定）", () => {
  it("管理者だけが登録でき、制作物の編集権限で割り当てられる。使っているアカウントは消せない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const profile = {
      platform: "instagram" as const,
      displayName: "第100回五月祭",
      username: "mayfes_official",
      verified: true,
    };
    await expect(cast.manager.as.mutation(api.social.save, profile)).rejects.toThrow(
      code("forbidden"),
    );
    const id = await cast.admin.as.mutation(api.social.save, profile);
    expect((await cast.creator.as.query(api.social.list, {})).map((p) => p.id)).toEqual([id]);
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "公式 Instagram",
      purpose: "告知",
      category: "SNS",
      mediaType: "sns",
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    })) as Id<"works">;
    await cast.manager.as.mutation(api.works.update, { workId, patch: { socialProfileId: id } });
    expect((await cast.creator.as.query(api.works.get, { workId })).work.socialProfileId).toBe(id);
    await expect(cast.admin.as.mutation(api.social.remove, { id })).rejects.toThrow(
      code("social_profile_in_use"),
    );
    await cast.manager.as.mutation(api.works.update, { workId, patch: { socialProfileId: null } });
    await cast.admin.as.mutation(api.social.remove, { id });
    expect(await cast.creator.as.query(api.social.list, {})).toEqual([]);
  });
});
