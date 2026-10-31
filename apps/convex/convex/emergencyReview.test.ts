import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { defaultSubmitDeadlineAt } from "@mf100/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, uploadVerified, type Harness } from "../test/harness";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

async function setupWork(t: Harness, cast: Awaited<ReturnType<typeof createCast>>) {
  const workId = (await cast.manager.as.mutation(api.works.create, {
    title: "MF100 パンフレット",
    purpose: "来場者案内",
    category: "印刷物",
    mediaType: "pdf",
    year: 100,
    creatorIds: [cast.creator.id],
    approverId: cast.approver.id,
    confidentiality: "normal",
  })) as Id<"works">;
  await cast.admin.as.mutation(api.acl.grant, {
    workId,
    userIds: [cast.reviewer.id],
    permission: "review",
  });
  return workId;
}

describe("緊急校正（Convex / e098）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reviewUrgent と短い deadlineAt を版に保存し、期限ジョブで閉じる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const at = Date.now() + 6 * HOUR + 30 * 60_000;
    const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      reviewUrgent: true,
      deadlineAt: at,
      changeSummary: "急ぎ",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    await uploadVerified(cast.creator, prepared.items[0]!.id, { size: 10, sha256: "a" });
    const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: prepared.sessionId as Id<"uploadSessions">,
    });
    const ws = await cast.creator.as.query(api.revisions.get, {
      revisionId: revisionId as Id<"revisions">,
    });
    expect(ws.revision.reviewUrgent).toBe(true);
    expect(ws.revision.deadlineAt).toBe(at);

    vi.setSystemTime(at + 1);
    expect(await t.mutation(internal.revisions.closeExpired, {})).toBe(1);
  });

  it("通常提出は既定の校正期日（日付だけ）で prepare できる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: defaultSubmitDeadlineAt(Date.now()),
      changeSummary: "通常",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    expect(prepared.sessionId).toBeTruthy();
  });

  it("緊急で上限を超える校正期日は拒否する", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    await expect(
      cast.creator.as.mutation(api.submissions.prepare, {
        workId,
        kind: "standard",
        reviewType: "general",
        reviewUrgent: true,
        deadlineAt: defaultSubmitDeadlineAt(Date.now()) + 1,
        changeSummary: "",
        focusNotes: "",
        items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
      }),
    ).rejects.toThrow(code("revision_deadline_after_max"));
  });
});
