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
      principalType: "user",
      principalId: cast.reviewer.id,
      permission: "review",
    });

    expect(await cast.creator.as.query(api.documents.get, { workId })).toEqual({
      draft: null,
      canEdit: true,
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
