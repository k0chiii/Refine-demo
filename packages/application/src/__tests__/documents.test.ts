import { describe, expect, it } from "vite-plus/test";
import { grantWorkPermission } from "../usecases/acl.ts";
import { getDocumentDraft, listWritableWorks, saveDocumentDraft } from "../usecases/documents.ts";
import { changeWorkLifecycle } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork } from "../testing/scenario.ts";

const code = (c: string) => expect.objectContaining({ code: c });
const doc = (t: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
  });

describe("文章の下書き", () => {
  it("制作者は書けて、版番号が進む。閲覧権限だけの人は読めるが書けない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    expect(await getDocumentDraft(ctx, principals.creator, work.id)).toEqual({
      draft: null,
      canEdit: true,
    });
    const saved = await saveDocumentDraft(ctx, principals.creator, {
      workId: work.id,
      title: "あいさつ",
      content: doc("こんにちは"),
      text: "こんにちは",
      baseVersion: 0,
    });
    expect(saved.version).toBe(1);
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: work.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    const view = await getDocumentDraft(ctx, principals.reviewer, work.id);
    expect(view.canEdit).toBe(false);
    expect(view.draft).toMatchObject({ title: "あいさつ", text: "こんにちは", version: 1 });
    await expect(
      saveDocumentDraft(ctx, principals.reviewer, {
        workId: work.id,
        title: "x",
        content: doc("x"),
        text: "x",
        baseVersion: 1,
      }),
    ).rejects.toThrow(code("forbidden"));
  });

  it("権限の無い人には存在も返さない（forbidden）", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { confidentiality: "restricted" });
    await expect(getDocumentDraft(ctx, principals.stranger, work.id)).rejects.toThrow(
      code("forbidden"),
    );
  });

  it("古い版番号からの保存は version_conflict（他の人の保存を上書きしない）", async () => {
    const ctx = createInMemoryContext();
    // 制作者が 2 人いて、同じ文章を別々に開いていた
    const work = await seedWork(ctx, {
      creatorIds: [principals.creator.userId, principals.manager.userId],
    });
    const input = { workId: work.id, title: "t", content: doc("a"), text: "a" };
    await saveDocumentDraft(ctx, principals.creator, { ...input, baseVersion: 0 });
    await saveDocumentDraft(ctx, principals.manager, { ...input, baseVersion: 1 });
    await expect(
      saveDocumentDraft(ctx, principals.creator, { ...input, baseVersion: 1 }),
    ).rejects.toThrow(code("version_conflict"));
  });

  it("進行中でない制作物には書けない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    await changeWorkLifecycle(ctx, principals.manager, { workId: work.id, to: "on_hold" });
    expect((await getDocumentDraft(ctx, principals.creator, work.id)).canEdit).toBe(false);
    await expect(
      saveDocumentDraft(ctx, principals.creator, {
        workId: work.id,
        title: "t",
        content: doc("a"),
        text: "a",
        baseVersion: 0,
      }),
    ).rejects.toThrow(code("work_not_active"));
  });
});

describe("SNS 投稿の下書き", () => {
  it("投稿の内容（mf100-post）を同じ保存先に保存でき、壊れた内容は拒否する", async () => {
    const { emptyPost, postManifest } = await import("@mf100/domain");
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { mediaType: "sns" });
    const content = postManifest({ ...emptyPost("x"), body: "#五月祭 開催！" });
    const r = await saveDocumentDraft(ctx, principals.creator, {
      workId: work.id,
      title: "告知",
      content,
      text: "#五月祭 開催！",
      baseVersion: 0,
    });
    expect(r.version).toBe(1);
    expect((await getDocumentDraft(ctx, principals.creator, work.id)).draft!.content).toBe(content);
    await expect(
      saveDocumentDraft(ctx, principals.creator, {
        workId: work.id,
        title: "告知",
        content: '{"kind":"mf100-post","version":9}',
        text: "",
        baseVersion: 1,
      }),
    ).rejects.toEqual(code("document_invalid"));
  });
});

describe("下書きの形式（原稿の消失を防ぐ）", () => {
  it("文章の制作物の下書きを SNS 投稿で上書きできない（document_format_mismatch）", async () => {
    const { emptyPost, postManifest } = await import("@mf100/domain");
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { mediaType: "document" });
    await saveDocumentDraft(ctx, principals.creator, {
      workId: work.id,
      title: "あいさつ",
      content: doc("大切な原稿"),
      text: "大切な原稿",
      baseVersion: 0,
    });
    await expect(
      saveDocumentDraft(ctx, principals.creator, {
        workId: work.id,
        title: "あいさつ",
        content: postManifest(emptyPost()),
        text: "",
        baseVersion: 1,
      }),
    ).rejects.toEqual(code("document_format_mismatch"));
    const view = await getDocumentDraft(ctx, principals.creator, work.id);
    expect(view.draft).toMatchObject({ version: 1, text: "大切な原稿" });
  });

  it("本文と平文の合計が大きすぎる下書きは document_too_large", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { mediaType: "document" });
    const text = "あ".repeat(180_000);
    await expect(
      saveDocumentDraft(ctx, principals.creator, {
        workId: work.id,
        title: "長文",
        content: doc(text),
        text,
        baseVersion: 0,
      }),
    ).rejects.toEqual(code("document_too_large"));
  });
});

describe("エディタの入口（書ける担当の制作物）", () => {
  it("版を提出できる人の、進行中の制作物だけ。最近書いた下書きが上", async () => {
    const ctx = createInMemoryContext();
    const a = await seedWork(ctx, { title: "A パンフレット" });
    const b = await seedWork(ctx, { title: "B ポスター" });
    const c = await seedWork(ctx, { title: "C 保留中" });
    await changeWorkLifecycle(ctx, principals.manager, { workId: c.id, to: "on_hold" });
    await saveDocumentDraft(ctx, principals.creator, {
      workId: b.id,
      title: "ポスター文案",
      content: doc("五 月 祭"),
      text: "五 月 祭",
      baseVersion: 0,
    });
    const works = await Promise.all([a, b, c].map((w) => ctx.works.findById(w.id)));
    const list = await listWritableWorks(
      ctx,
      principals.creator,
      works.filter((w) => w !== null),
    );
    expect(list.map((w) => w.title)).toEqual(["B ポスター", "A パンフレット"]);
    expect(list[0]!.draft).toMatchObject({ title: "ポスター文案", chars: 3 });
    expect(list[1]!.draft).toBeNull();

    // 校正の権限だけの人には出ない
    await grantWorkPermission(ctx, principals.sysadmin, {
      workId: a.id,
      userIds: [principals.reviewer.userId],
      permission: "review",
    });
    expect(
      await listWritableWorks(
        ctx,
        principals.reviewer,
        works.filter((w) => w !== null),
      ),
    ).toEqual([]);
  });
});
