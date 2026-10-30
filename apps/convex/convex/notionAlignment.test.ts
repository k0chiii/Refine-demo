import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, uploadVerified } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

/**
 * Convex 統合: Notion の制作物 DB・版 DB・担当 DB・ユーザ DB に揃えた項目（docs/NOTION_ALIGNMENT.md）。
 * 保存 → 読み出し → 一覧の絞り込み → 版の申告 → 「現在の版」の申告、を一周する。
 */
describe("Convex 統合: Notion に揃えた制作物・版・担当・ユーザの項目", () => {
  it("登録・変更・詳細・一覧（大ジャンルで絞る）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const bureau = await cast.admin.as.mutation(api.teams.save, {
      name: "広報局",
      kind: "bureau",
      code: "PR",
      emoji: "📣",
    });
    const design = await cast.admin.as.mutation(api.teams.save, {
      name: "デザイン担当",
      kind: "team",
      parentId: bureau,
      memberIds: [cast.stranger.id],
    });
    const web = await cast.admin.as.mutation(api.teams.save, {
      name: "Web担当",
      kind: "team",
      parentId: bureau,
    });
    const base = {
      title: "公式パンフレット",
      purpose: "来場者向け",
      category: "印刷物（冊子）",
      mediaType: "pdf" as const,
      year: 100,
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    };
    const workId = (await cast.manager.as.mutation(api.works.create, {
      ...base,
      genre: "graphic",
      subGenre: "print_booklet",
      stakeholderIds: [cast.reviewer.id],
      productionTeamIds: [design],
      relatedTeamIds: [bureau],
      requiresPrinterSubmission: true,
      printQuantity: 3000,
      sizeOrLength: "A5",
      tags: ["公式パンフ"],
    })) as Id<"works">;
    const detail = await cast.manager.as.query(api.works.get, { workId });
    expect(detail.work).toMatchObject({
      genre: "graphic",
      subGenre: "print_booklet",
      stakeholderIds: [cast.reviewer.id],
      relatedTeamIds: [bureau],
      tags: ["公式パンフ"],
    });
    expect(detail.people.stakeholders.map((p) => p?.name)).toEqual(["reviewer"]);
    expect(detail.currentDeclarations).toBeNull();
    // 制作担当は 1 つまで（利用者決定 2026-10-17。ポリシー値）
    await expect(
      cast.manager.as.mutation(api.works.create, { ...base, productionTeamIds: [design, web] }),
    ).rejects.toThrow(code("work_invalid"));
    await expect(
      cast.manager.as.mutation(api.works.update, {
        workId,
        patch: { productionTeamIds: [design, web] },
      }),
    ).rejects.toThrow(code("work_invalid"));
    // 通常の制作物は委員なら誰でも見られ（利用者決定 2026-10-17）、コメントも書ける（同 2026-10-19）。編集・提出はできない
    const seen = await cast.reviewer.as.query(api.works.get, { workId });
    expect(seen.can).toMatchObject({ edit: false, comment: true, submit: false });
    expect((await cast.stranger.as.query(api.works.listMine, {})).map((w) => w.id)).toEqual([
      workId,
    ]);
    // 非公開にすると、関係者（reviewer）と制作担当に所属する人（stranger）は自動で見られる。システム管理者も見られる（2026-10-30）
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { confidentiality: "restricted" },
    });
    await expect(cast.reviewer.as.query(api.works.get, { workId })).resolves.toBeTruthy();
    await expect(cast.stranger.as.query(api.works.get, { workId })).resolves.toBeTruthy();
    await expect(cast.admin.as.query(api.works.get, { workId })).resolves.toBeTruthy();
    // 一覧・ダッシュボードも同じ判定（所属は要るときだけ読む。docs/UI_M3E.md §60）
    expect((await cast.stranger.as.query(api.works.listMine, {})).map((w) => w.id)).toEqual([
      workId,
    ]);
    expect((await cast.reviewer.as.query(api.works.listMine, {})).map((w) => w.id)).toEqual([
      workId,
    ]);
    expect((await cast.admin.as.query(api.works.listMine, {})).map((w) => w.id)).toEqual([workId]);
    await expect(cast.stranger.as.query(api.dashboard.get, {})).resolves.toBeTruthy();
    // 所属を外すと見られなくなる
    await cast.admin.as.mutation(api.teams.save, {
      id: design,
      name: "デザイン担当",
      kind: "team",
      parentId: bureau,
      memberIds: [],
    });
    await expect(cast.stranger.as.query(api.works.get, { workId })).rejects.toThrow(
      code("forbidden"),
    );
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { confidentiality: "normal" },
    });

    // 変更: null で消す。一覧は大ジャンルで絞れる
    await cast.manager.as.mutation(api.works.update, {
      workId,
      patch: { tags: null, genre: "text_ja", subGenre: "pr_text", printQuantity: null },
    });
    const after = (await cast.manager.as.query(api.works.get, { workId })).work;
    expect(after).toMatchObject({ genre: "text_ja", subGenre: "pr_text" });
    expect(after).not.toHaveProperty("tags");
    expect(after).not.toHaveProperty("printQuantity");
    expect(await cast.creator.as.query(api.works.listMine, { genre: "graphic" })).toEqual([]);
    const [row] = await cast.creator.as.query(api.works.listMine, { genre: "text_ja" });
    expect(row).toMatchObject({ id: workId, genre: "text_ja", subGenre: "pr_text", tags: [] });
  });

  it("版の提出で申告と確認を記録し、制作物の「現在の版」の申告になる。写真の申告は専門確認と一緒に", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = (await cast.manager.as.mutation(api.works.create, {
      title: "広報文",
      purpose: "",
      category: "広報文",
      mediaType: "pdf",
      year: 100,
      genre: "text_ja",
      creatorIds: [cast.creator.id],
      approverId: cast.approver.id,
    })) as Id<"works">;
    const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: Date.now() + 24 * HOUR,
      changeSummary: "初稿",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
      declarations: { usesPhotos: true, usesMascot: true, usesOffPaletteColors: false },
      selfChecks: ["theme_font", "notation_checked"],
      requiredChecks: [{ type: "photo", label: "写真（肖像・権利）" }],
    });
    await uploadVerified(cast.creator, prepared.items[0]!.id, { size: 10, sha256: "a" });
    const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: prepared.sessionId as Id<"uploadSessions">,
    });
    const rev = await cast.creator.as.query(api.revisions.get, { revisionId });
    expect(rev.revision.declarations).toEqual({
      usesPhotos: true,
      usesMascot: true,
      usesOffPaletteColors: false,
    });
    expect(rev.revision.selfChecks).toEqual(["theme_font", "notation_checked"]);
    expect(rev.checks.map((c) => c.type)).toEqual(["photo"]);
    const detail = await cast.creator.as.query(api.works.get, { workId });
    expect(detail.currentDeclarations).toEqual({
      usesPhotos: true,
      usesMascot: true,
      usesOffPaletteColors: false,
    });
  });

  it("担当のコード・絵文字・所属と、ユーザの代（管理者だけが付ける）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const pr = await cast.admin.as.mutation(api.teams.save, {
      name: "広報局",
      kind: "bureau",
      code: "pr",
      emoji: "📣",
    });
    await cast.admin.as.mutation(api.teams.save, {
      name: "デザイン担当",
      kind: "team",
      parentId: pr,
      memberIds: [cast.creator.id],
    });
    await expect(
      cast.admin.as.mutation(api.teams.save, { name: "別の局", kind: "bureau", code: "PR" }),
    ).rejects.toThrow(code("team_duplicate"));
    await expect(
      cast.admin.as.mutation(api.teams.save, {
        name: "担当",
        kind: "team",
        parentId: pr,
        memberIds: ["ghost"],
      }),
    ).rejects.toThrow(code("team_invalid"));
    const list = await cast.creator.as.query(api.teams.list, {});
    expect(list[0]).toMatchObject({ name: "広報局", code: "PR", emoji: "📣" });
    expect(list[1]).toMatchObject({ name: "デザイン担当", memberIds: [cast.creator.id] });
    // CSV の所属の照合に使う名簿は管理者だけ
    expect(await cast.manager.as.query(api.teams.importDirectory, { keys: ["creator"] })).toEqual(
      [],
    );
    expect(
      (await cast.admin.as.query(api.teams.importDirectory, { keys: ["creator"] })).map(
        (u) => u.id,
      ),
    ).toEqual([cast.creator.id]);

    // 代
    await expect(
      cast.manager.as.mutation(api.admin.setGeneration, {
        userId: cast.creator.id,
        generation: 100,
      }),
    ).rejects.toThrow();
    await cast.admin.as.mutation(api.admin.setGeneration, {
      userId: cast.creator.id,
      generation: 100,
    });
    const users = await cast.admin.as.query(api.acl.searchUsers, { text: "creator" });
    expect(users[0]).toMatchObject({ id: cast.creator.id, generation: 100 });
    const found = await cast.creator.as.query(api.users.search, { text: "creator" });
    expect(found[0]).toMatchObject({ generation: 100 });
    await cast.admin.as.mutation(api.admin.setGeneration, {
      userId: cast.creator.id,
      generation: null,
    });
    expect(
      (await cast.admin.as.query(api.acl.searchUsers, { text: "creator" }))[0]!.generation,
    ).toBeNull();
  });
});
