import { api } from "./_generated/api";
import { describe, expect, it } from "vite-plus/test";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";
import { upsertNogikuUser } from "./auth.ts";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("名前はふりがな（ひらがな）で出す（利用者指示 2026-10-21）", () => {
  it("Nogiku の hurigana を保存し、表示名はひらがな・検索はひらがな／カタカナ／漢字のどれでも当たる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const id = await t.run((ctx) =>
      upsertNogikuUser(ctx, {
        existingUserId: null,
        profile: { sub: "hongo", name: "本郷 校正", hurigana: "ホンゴウ コウセイ" },
      }),
    );
    expect((await t.run((ctx) => ctx.db.get(id)))?.hurigana).toBe("ホンゴウ コウセイ");
    for (const text of ["ほんごう", "ホンゴウ", "本郷"])
      expect(
        (await cast.creator.as.query(api.users.search, { text })).map((u) => [u.id, u.name]),
      ).toEqual([[id, "ほんごう こうせい"]]);
    expect(await cast.creator.as.query(api.users.byIds, { ids: [id] })).toEqual([
      { id, name: "ほんごう こうせい", email: null },
    ]);
  });
});

describe("メンバーのグループ", () => {
  it("管理者が作ったグループを、メンションの候補に出し、「@グループ名」の本文を強調する名前を返す", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    await expect(
      cast.manager.as.mutation(api.groups.save, { name: "こうせいはん", memberIds: [] }),
    ).rejects.toThrow(code("forbidden"));
    const groupId = await cast.admin.as.mutation(api.groups.save, {
      name: "こうせいはん",
      memberIds: [cast.reviewer.id, cast.approver.id],
    });
    expect(
      (await cast.creator.as.query(api.groups.list, {})).map((g) => [g.name, g.memberIds]),
    ).toEqual([["こうせいはん", [cast.reviewer.id, cast.approver.id]]]);

    const workId = await setupWork(t, cast);
    const { revisionId } = await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    const candidates = await cast.creator.as.query(api.comments.searchMentionCandidates, {
      workId,
      text: "コウセイ",
    });
    expect(candidates[0]).toEqual({
      id: `group:${groupId}`,
      name: "こうせいはん",
      email: null,
      memberCount: 2,
    });

    await cast.creator.as.mutation(api.comments.post, {
      revisionId,
      body: "@こうせいはん 見てください",
      kind: "question",
      severity: "info",
      mentions: [`group:${groupId}`],
    });
    const rev = await cast.creator.as.query(api.revisions.get, { revisionId });
    const thread = rev.threads[0]!;
    expect(thread.mentions).toEqual([cast.reviewer.id, cast.approver.id]);
    expect(thread.mentionUsers.map((u) => u.name)).toEqual([
      "reviewer",
      "approver",
      "こうせいはん",
    ]);
    const mine = await cast.approver.as.query(api.notifications.list, {});
    expect(mine.map((n: { kind: string }) => n.kind)).toContain("mentioned");

    // 消したグループは強調しなくなるだけ（知らせた人は残る）
    await cast.admin.as.mutation(api.groups.remove, { id: groupId });
    const after = (await cast.creator.as.query(api.revisions.get, { revisionId })).threads[0]!;
    expect(after.mentionUsers.map((u) => u.name)).toEqual(["reviewer", "approver"]);
  });
});
