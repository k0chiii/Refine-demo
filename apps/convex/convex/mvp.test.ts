import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCast, createHarness, HOUR, type Harness } from "../test/harness";

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
  })) as Id<"works">;
  await cast.admin.as.mutation(api.acl.grant, {
    workId,
    principalType: "user",
    principalId: cast.reviewer.id,
    permission: "review",
  });
  return workId;
}

async function submit(
  t: Harness,
  cast: Awaited<ReturnType<typeof createCast>>,
  workId: Id<"works">,
  opts: { kind?: "rough" | "standard"; hours?: number; verifyAll?: boolean } = {},
) {
  const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
    workId,
    kind: opts.kind ?? "standard",
    reviewType: "general",
    deadlineAt: Date.now() + (opts.hours ?? 24) * HOUR,
    changeSummary: "初稿",
    focusNotes: "配色",
    items: [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
      { fileName: "b.pdf", mimeType: "application/pdf", type: "pdf", role: "source" },
    ],
  });
  const [a, b] = prepared.items;
  await cast.creator.as.mutation(api.submissions.markVerified, {
    itemId: a!.id as Id<"uploadItems">,
    size: 10,
    sha256: "a",
  });
  if (opts.verifyAll !== false)
    await cast.creator.as.mutation(api.submissions.markVerified, {
      itemId: b!.id as Id<"uploadItems">,
      size: 10,
      sha256: "b",
    });
  else
    await cast.creator.as.mutation(api.submissions.markFailed, {
      itemId: b!.id as Id<"uploadItems">,
      message: "通信断",
    });
  return { sessionId: prepared.sessionId as Id<"uploadSessions">, items: prepared.items };
}

describe("Convex 統合: 認可と状態遷移", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 1, 9, 0, 0), toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("A-01 / A-20: 権限のない Nogiku ユーザーは作品 ID を直接指定しても一覧・詳細・添付を得られない。個人 ACL だけで閲覧できる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);

    await expect(cast.stranger.as.query(api.works.get, { workId })).rejects.toThrow(
      code("forbidden"),
    );
    expect(await cast.stranger.as.query(api.works.listMine, {})).toEqual([]);
    // 管理者も職責/ACL が無ければ見えない
    await expect(cast.admin.as.query(api.works.get, { workId })).rejects.toThrow(code("forbidden"));

    const detail = await cast.reviewer.as.query(api.works.get, { workId });
    expect(detail.work.title).toBe("MF100 パンフレット");
    expect(detail.can).toMatchObject({
      comment: true,
      decide: false,
      finalize: false,
      manageAcl: false,
      submit: false,
    });
    expect((await cast.reviewer.as.query(api.works.listMine, {})).map((w) => w.id)).toEqual([
      workId,
    ]);
    // 未ログイン
    await expect(t.query(api.works.get, { workId })).rejects.toThrow(code("unauthenticated"));
  });

  it("A-19 / A-11: 管理者のみ ACL を変更でき、剥奪後は閲覧・投稿・添付認可ができない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { sessionId } = await submit(t, cast, workId);
    const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, { sessionId });
    const rev = await cast.reviewer.as.query(api.revisions.get, { revisionId });
    const artifactId = rev.artifacts[0]!.id as Id<"artifacts">;

    await expect(
      cast.manager.as.mutation(api.acl.grant, {
        workId,
        principalType: "user",
        principalId: cast.stranger.id,
        permission: "view",
      }),
    ).rejects.toThrow(code("acl_requires_system_admin"));
    await expect(
      cast.reviewer.as.query(api.artifacts.authorizeAccess, { artifactId }),
    ).resolves.toMatchObject({ mimeType: "application/pdf" });
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: revisionId as Id<"revisions">,
      body: "a",
      kind: "question",
      severity: "info",
    });

    await cast.admin.as.mutation(api.acl.revoke, {
      workId,
      principalType: "user",
      principalId: cast.reviewer.id,
    });
    await expect(cast.reviewer.as.query(api.works.get, { workId })).rejects.toThrow(
      code("forbidden"),
    );
    await expect(
      cast.reviewer.as.query(api.artifacts.authorizeAccess, { artifactId }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: revisionId as Id<"revisions">,
        body: "b",
        kind: "question",
        severity: "info",
      }),
    ).rejects.toThrow(code("forbidden"));
    const history = await cast.admin.as.query(api.acl.list, { workId });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      permission: "review",
      revoker: expect.objectContaining({ id: cast.admin.id }),
    });
  });

  it("A-16 / A-17: 失敗した提出は旧版を閉じず、成功した確定は同一処理で旧版を superseded にする", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const s1 = await submit(t, cast, workId);
    const r1 = await cast.creator.as.mutation(api.submissions.confirm, { sessionId: s1.sessionId });
    expect(r1).toMatchObject({ sequence: 1, kind: "standard", supersededRevisionId: null });

    // 第2版: 1 ファイル失敗 → 確定できない。第1版は受付中のまま
    vi.setSystemTime(Date.now() + HOUR);
    const s2 = await submit(t, cast, workId, { verifyAll: false });
    await expect(
      cast.creator.as.mutation(api.submissions.confirm, { sessionId: s2.sessionId }),
    ).rejects.toThrow(code("revision_artifacts_not_verified"));
    let detail = await cast.creator.as.query(api.works.get, { workId });
    expect(detail.revisions).toHaveLength(1);
    expect(detail.acceptingRevisionId).toBe(r1.revisionId);

    // 再アップロードして確定 → 第1版が superseded、第2版のみ受付
    const failed = s2.items[1]!;
    await cast.creator.as.mutation(api.submissions.reset, {
      itemId: failed.id as Id<"uploadItems">,
    });
    await cast.creator.as.mutation(api.submissions.markVerified, {
      itemId: failed.id as Id<"uploadItems">,
      size: 10,
      sha256: "b2",
    });
    const r2 = await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: s2.sessionId,
      requestId: "confirm-2",
    });
    expect(r2).toMatchObject({ sequence: 2, supersededRevisionId: r1.revisionId });
    // 同じ requestId の再送は同じ版を返す（A-10）
    expect(
      await cast.creator.as.mutation(api.submissions.confirm, {
        sessionId: s2.sessionId,
        requestId: "confirm-2",
      }),
    ).toMatchObject({ revisionId: r2.revisionId });

    detail = await cast.creator.as.query(api.works.get, { workId });
    expect(
      detail.revisions.map((r) => [r.label, r.reviewState, r.reviewClosedReason ?? null]),
    ).toEqual([
      ["第2版", "open", null],
      ["第1版", "closed", "superseded"],
    ]);
    await expect(
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: r1.revisionId as Id<"revisions">,
        body: "x",
        kind: "correction",
        severity: "minor",
      }),
    ).rejects.toThrow(code("revision_not_accepting"));
    const ws = await cast.reviewer.as.query(api.revisions.get, { revisionId: r1.revisionId });
    expect(ws.can.comment).toBe(false);
    expect(ws.commentBlockedReason).toBe("superseded");
  });

  it("A-04 / A-05: 期限境界はサーバーの時刻比較で判定し、期限ジョブは受付だけを閉じる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { sessionId } = await submit(t, cast, workId, { hours: 1 });
    const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, { sessionId });
    const deadline = Date.now() + HOUR;
    await cast.manager.as.mutation(api.reviews.assign, {
      revisionId: revisionId as Id<"revisions">,
      reviewerIds: [cast.reviewer.id],
      reviewType: "general",
    });
    const post = () =>
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: revisionId as Id<"revisions">,
        body: "誤字",
        kind: "correction",
        severity: "major",
      });

    vi.setSystemTime(deadline - 1000);
    await expect(post()).resolves.toBeTruthy();
    vi.setSystemTime(deadline);
    await expect(post()).rejects.toThrow(code("revision_deadline_passed"));
    vi.setSystemTime(deadline + 1000);
    await expect(post()).rejects.toThrow(code("revision_deadline_passed"));

    expect(await t.mutation(internal.revisions.closeExpired, {})).toBe(1);
    const ws = await cast.creator.as.query(api.revisions.get, { revisionId });
    expect(ws.revision.reviewState).toBe("closed");
    expect(ws.revision.reviewClosedReason).toBe("deadline");
    expect(ws.assignments[0]?.state).toBe("viewed"); // 未読→閲覧済にはなるが確認完了にはならない
    expect(ws.threads[0]?.resolution).toBe("open");
    expect(ws.work.lifecycle).toBe("active");
    const queue = await cast.reviewer.as.query(api.reviews.myQueue, {});
    expect(queue[0]).toMatchObject({ overdue: true, assignmentState: "viewed", myCommentCount: 1 });
  });

  it("A-07 / A-08 / A-09: 採否・校了ガード・例外校了・再開が監査付きで動く", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const { sessionId } = await submit(t, cast, workId);
    const { revisionId } = await cast.creator.as.mutation(api.submissions.confirm, { sessionId });
    const rid = revisionId as Id<"revisions">;
    const threadId = (await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: rid,
      body: "団体名誤り",
      kind: "correction",
      severity: "critical",
    })) as Id<"commentThreads">;

    // 校正者は採否不可、制作者は理由付き不採用が可能で履歴が残る
    await expect(
      cast.reviewer.as.mutation(api.comments.decide, { threadId, action: "rejected", reason: "x" }),
    ).rejects.toThrow(code("forbidden"));
    await expect(
      cast.creator.as.mutation(api.comments.decide, { threadId, action: "rejected" }),
    ).rejects.toThrow(code("comment_reason_required"));

    // 重大未解決のまま校了 → 拒否。例外理由付きなら可
    await expect(
      cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId: rid }),
    ).rejects.toThrow(code("approval_blocking_threads_remain"));
    await expect(
      cast.manager.as.mutation(api.approvals.finalize, {
        workId,
        revisionId: rid,
        exceptionReason: "x",
      }),
    ).rejects.toThrow(code("forbidden"));
    const fin = await cast.approver.as.mutation(api.approvals.finalize, {
      workId,
      revisionId: rid,
      exceptionReason: "入稿期限のため訂正シールで対応",
      requestId: "fin-1",
    });
    expect(fin.action).toBe("exception_finalized");
    expect(
      await cast.approver.as.mutation(api.approvals.finalize, {
        workId,
        revisionId: rid,
        exceptionReason: "再送",
        requestId: "fin-1",
      }),
    ).toEqual(fin);

    // 校了後: 版提出・指摘・採否は拒否
    await expect(submit(t, cast, workId)).rejects.toThrow(code("work_already_finalized"));
    await expect(
      cast.creator.as.mutation(api.comments.decide, { threadId, action: "accepted" }),
    ).rejects.toThrow(code("work_already_finalized"));
    let detail = await cast.approver.as.query(api.works.get, { workId });
    expect(detail.work.lifecycle).toBe("finalized");
    expect(detail.approvals.map((a) => a.action)).toEqual(["exception_finalized"]);

    // 理由付き再開 → 履歴が残り、採否と次版提出が可能になる
    await expect(
      cast.approver.as.mutation(api.approvals.reopen, { workId, reason: "" }),
    ).rejects.toThrow(code("approval_reopen_reason_required"));
    await cast.approver.as.mutation(api.approvals.reopen, { workId, reason: "誤記の訂正が必要" });
    detail = await cast.approver.as.query(api.works.get, { workId });
    expect(detail.approvals.map((a) => a.action)).toEqual(["exception_finalized", "reopened"]);
    await cast.creator.as.mutation(api.comments.decide, { threadId, action: "accepted" });
    const events = await cast.creator.as.query(api.comments.events, { threadId });
    expect(events.events.map((e) => e.eventType)).toEqual(["created", "decided"]);
    const log = await cast.admin.as.query(api.admin.auditLog, {
      entityType: "work",
      entityId: workId,
    });
    expect(log.map((e) => e.operation)).toEqual(["reopened", "exception_finalized", "create"]);
  });

  it("A-18: 0版（ラフ）は別区分で、第1版は 1 から始まる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const s0 = await submit(t, cast, workId, { kind: "rough" });
    const r0 = await cast.creator.as.mutation(api.submissions.confirm, { sessionId: s0.sessionId });
    expect(r0).toMatchObject({ kind: "rough", sequence: 0 });
    vi.setSystemTime(Date.now() + HOUR);
    const s1 = await submit(t, cast, workId);
    const r1 = await cast.creator.as.mutation(api.submissions.confirm, { sessionId: s1.sessionId });
    expect(r1).toMatchObject({
      kind: "standard",
      sequence: 1,
      supersededRevisionId: r0.revisionId,
    });
    const detail = await cast.creator.as.query(api.works.get, { workId });
    expect(detail.revisions.map((r) => r.label)).toEqual(["第1版", "0版（ラフ）"]);
    await expect(
      cast.approver.as.mutation(api.approvals.finalize, {
        workId,
        revisionId: r0.revisionId as Id<"revisions">,
      }),
    ).rejects.toThrow(code("approval_rough_revision"));
  });
});
