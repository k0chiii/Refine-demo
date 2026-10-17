import { describe, expect, it } from "vite-plus/test";
import { confirmSubmission, prepareSubmission } from "../usecases/submissions.ts";
import { saveTeam } from "../usecases/teams.ts";
import { importWorks, updateWork } from "../usecases/works.ts";
import { createInMemoryContext } from "../testing/inMemory.ts";
import { principals, seedWork, uploadVerifiedItem } from "../testing/scenario.ts";

const invalid = (field: string, reason: string) =>
  expect.objectContaining({
    code: "work_invalid",
    details: expect.objectContaining({ field, reason }),
  });
const HOUR = 3_600_000;

describe("Notion の制作物 DB に揃えた項目の登録・変更（docs/NOTION_ALIGNMENT.md）", () => {
  it("登録で大ジャンル・小ジャンル・関係者・入稿・タグ・リンクを持ち、関係者は名簿にいること", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, {
      genre: "graphic",
      subGenre: "print_booklet",
      stakeholderIds: [principals.reviewer.userId],
      publishAt: ctx.clock.now() + 30 * 24 * HOUR,
      requiresPrinterSubmission: true,
      printQuantity: 3000,
      sizeOrLength: " A5 ",
      productionDays: 20,
      tags: ["公式パンフ", "公式パンフ", " マスター "],
      driveFolderUrl: "https://drive.google.com/drive/folders/x",
      slackChannelId: "c0123abcdef",
    });
    expect(work).toMatchObject({
      genre: "graphic",
      subGenre: "print_booklet",
      stakeholderIds: [principals.reviewer.userId],
      requiresPrinterSubmission: true,
      printQuantity: 3000,
      sizeOrLength: "A5",
      productionDays: 20,
      tags: ["公式パンフ", "マスター"],
      slackChannelId: "C0123ABCDEF",
    });
    await expect(seedWork(ctx, { stakeholderIds: ["ghost"] })).rejects.toThrow(
      invalid("stakeholderIds", "unknown_user"),
    );
    await expect(seedWork(ctx, { slackChannelId: "#general" })).rejects.toThrow(
      invalid("slackChannelId", "format"),
    );
    // 関係者は職責ではない（主管に入らない）。閲覧は自動で付く（acl.test.ts）
    const roles = ctx.state.works.get(work.id)!;
    expect(roles.managerIds).not.toContain(principals.reviewer.userId);
  });

  it("制作担当は 1 つまで（ポリシー値。利用者決定 2026-10-17）。登録・変更・一括登録のどこでも", async () => {
    const ctx = createInMemoryContext();
    const pr = await saveTeam(ctx, principals.sysadmin, { name: "広報局", kind: "bureau" });
    const design = await saveTeam(ctx, principals.sysadmin, {
      name: "デザイン担当",
      kind: "team",
      parentId: pr.id,
    });
    const web = await saveTeam(ctx, principals.sysadmin, {
      name: "Web担当",
      kind: "team",
      parentId: pr.id,
    });
    await expect(seedWork(ctx, { productionTeamIds: [design.id, web.id] })).rejects.toThrow(
      invalid("productionTeamIds", "too_many"),
    );
    const work = await seedWork(ctx, { productionTeamIds: [design.id] });
    expect(work.productionTeamIds).toEqual([design.id]);
    // あとから変えられる（置き換え・外す）
    const changed = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { productionTeamIds: [web.id] },
    });
    expect(changed.productionTeamIds).toEqual([web.id]);
    await expect(
      updateWork(ctx, principals.manager, {
        workId: work.id,
        patch: { productionTeamIds: [design.id, web.id] },
      }),
    ).rejects.toThrow(invalid("productionTeamIds", "too_many"));
    // 古い行に 2 つあっても、制作担当を触らない変更は通る
    await ctx.works.update({ ...changed, productionTeamIds: [design.id, web.id] });
    const renamed = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { title: "新しい名称" },
    });
    expect(renamed.productionTeamIds).toEqual([design.id, web.id]);
    const row = {
      title: "A",
      year: 100,
      purpose: "",
      category: "映像",
      mediaType: "video" as const,
      creatorIds: [principals.creator.userId],
      managerIds: [],
      approverId: principals.approver.userId,
      confidentiality: "normal" as const,
      notationCategories: [],
      productionTeamIds: [design.id, web.id],
    };
    await expect(importWorks(ctx, principals.sysadmin, { rows: [row] })).rejects.toThrow(
      expect.objectContaining({ code: "work_import_invalid" }),
    );
  });

  it("変更では null で消し、省略した項目は触らない。関係担当も組織にある担当だけ", async () => {
    const ctx = createInMemoryContext();
    const bureau = await saveTeam(ctx, principals.sysadmin, {
      name: "総務局",
      kind: "bureau",
      code: "JIM",
    });
    const work = await seedWork(ctx, { tags: ["a"], genre: "video", subGenre: "video" });
    const next = await updateWork(ctx, principals.manager, {
      workId: work.id,
      patch: { tags: null, publishAt: ctx.clock.now() + HOUR, relatedTeamIds: [bureau.id] },
    });
    expect(next).toMatchObject({ genre: "video", subGenre: "video", relatedTeamIds: [bureau.id] });
    expect(next).not.toHaveProperty("tags");
    await expect(
      updateWork(ctx, principals.manager, { workId: work.id, patch: { relatedTeamIds: ["nope"] } }),
    ).rejects.toThrow(expect.objectContaining({ code: "team_not_found" }));
  });

  it("一括登録: 揃えた項目をそのまま登録する（有効性・校了済みは取り込まない。状態は登録してから操作で入れる）", async () => {
    const ctx = createInMemoryContext();
    const [a, b] = await importWorks(ctx, principals.sysadmin, {
      rows: [
        {
          title: "A",
          year: 100,
          purpose: "",
          category: "映像",
          mediaType: "video",
          genre: "video",
          subGenre: "video",
          creatorIds: [principals.creator.userId],
          managerIds: [],
          approverId: principals.approver.userId,
          confidentiality: "normal",
          notationCategories: [],
          productionTeamIds: [],
        },
        {
          title: "B",
          year: 100,
          purpose: "",
          category: "広報文",
          mediaType: "document",
          creatorIds: [principals.creator.userId],
          managerIds: [],
          approverId: principals.approver.userId,
          confidentiality: "normal",
          notationCategories: [],
          productionTeamIds: [],
          tags: ["1次公開"],
        },
      ],
    });
    expect(a).toMatchObject({ lifecycle: "active", genre: "video", subGenre: "video" });
    expect(b).toMatchObject({ lifecycle: "active", tags: ["1次公開"] });
  });
});

describe("版の提出時の申告と確認（Notion の版 DB に揃えた）", () => {
  it("準備で受け取った申告・確認が確定で版に写る。知らない確認の ID は捨てる", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx, { genre: "text_ja" });
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
      declarations: { usesPhotos: true, usesMascot: false, usesOffPaletteColors: false },
      selfChecks: ["theme_font", "notation_checked", "bogus", "theme_font"],
      requiredChecks: [{ type: "photo" }],
    });
    await uploadVerifiedItem(ctx, principals.creator, {
      itemId: prepared.items[0]!.id,
      size: 10,
      sha256: "a",
    });
    const { revision } = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    });
    expect(revision.declarations).toEqual({
      usesPhotos: true,
      usesMascot: false,
      usesOffPaletteColors: false,
    });
    expect(revision.selfChecks).toEqual(["theme_font", "notation_checked"]);
    expect(ctx.state.checks.all().map((c) => c.type)).toEqual(["photo"]);
  });

  it("申告の無い提出（古い画面）はそのまま確定でき、版に申告は付かない", async () => {
    const ctx = createInMemoryContext();
    const work = await seedWork(ctx);
    const prepared = await prepareSubmission(ctx, principals.creator, {
      workId: work.id,
      kind: "standard",
      reviewType: "general",
      deadlineAt: ctx.clock.now() + 24 * HOUR,
      changeSummary: "",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    await uploadVerifiedItem(ctx, principals.creator, {
      itemId: prepared.items[0]!.id,
      size: 10,
      sha256: "a",
    });
    const { revision } = await confirmSubmission(ctx, principals.creator, {
      sessionId: prepared.session.id,
    });
    expect(revision).not.toHaveProperty("declarations");
    expect(revision).not.toHaveProperty("selfChecks");
  });
});

describe("担当（Notion の担当 DB に揃えた項目）", () => {
  it("局のコード・絵文字・Drive・所属を保存し、省略した変更では残す。所属は名簿にいる人だけ", async () => {
    const ctx = createInMemoryContext();
    const pr = await saveTeam(ctx, principals.sysadmin, {
      name: "広報局",
      kind: "bureau",
      code: "PR",
      emoji: "📣",
      driveFolderUrl: "https://drive.google.com/drive/folders/pr",
    });
    const design = await saveTeam(ctx, principals.sysadmin, {
      name: "デザイン担当",
      kind: "team",
      parentId: pr.id,
      memberIds: [principals.creator.userId, principals.creator.userId],
    });
    expect(pr).toMatchObject({ code: "PR", emoji: "📣" });
    expect(design.memberIds).toEqual([principals.creator.userId]);
    // 並べ替えなどで項目を省略しても消えない。null で消す
    const kept = await saveTeam(ctx, principals.sysadmin, {
      id: pr.id,
      name: "広報局",
      kind: "bureau",
      order: 5,
    });
    expect(kept).toMatchObject({ code: "PR", emoji: "📣", order: 5 });
    const cleared = await saveTeam(ctx, principals.sysadmin, {
      id: pr.id,
      name: "広報局",
      kind: "bureau",
      emoji: null,
    });
    expect(cleared).not.toHaveProperty("emoji");
    expect(cleared.code).toBe("PR");
    await expect(
      saveTeam(ctx, principals.sysadmin, {
        name: "担当",
        kind: "team",
        parentId: pr.id,
        memberIds: ["ghost"],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "team_invalid" }));
  });
});
