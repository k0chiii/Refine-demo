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

  it("v1: 専門確認・通知・担当者・訂正・持越・無効化・清掃が一周する", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);

    // 提出時に専門確認を宣言（担当: reviewer）
    const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: Date.now() + 2 * HOUR,
      changeSummary: "初稿",
      focusNotes: "",
      items: [{ fileName: "a.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
      requiredChecks: [{ type: "photo", label: "写真の権利確認", assigneeId: cast.reviewer.id }],
    });
    await cast.creator.as.mutation(api.submissions.markVerified, {
      itemId: prepared.items[0]!.id as Id<"uploadItems">,
      size: 1,
      sha256: "a",
    });
    const { revisionId: rid1 } = await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: prepared.sessionId as Id<"uploadSessions">,
    });
    const revisionId = rid1 as Id<"revisions">;

    // 提出通知: 職責者（manager/approver）に届き、本人（creator）には届かない。確認担当にも依頼が届く
    expect(await cast.manager.as.query(api.notifications.unreadCount, {})).toBe(1);
    expect(await cast.creator.as.query(api.notifications.unreadCount, {})).toBe(0);
    const reviewerNotes = await cast.reviewer.as.query(api.notifications.list, {});
    expect(reviewerNotes.map((n) => n.kind)).toContain("check_requested");

    // 校了は確認未完了でブロック。例外理由付きなら可（ここでは通常経路で完了させる）
    await expect(
      cast.approver.as.mutation(api.approvals.finalize, { workId, revisionId }),
    ).rejects.toThrow(code("approval_required_checks_incomplete"));

    const ws = await cast.reviewer.as.query(api.revisions.get, { revisionId });
    expect(ws.checks).toHaveLength(1);
    expect(ws.checks[0]).toMatchObject({ state: "pending", canComplete: true, canWaive: false });
    expect(ws.can).toMatchObject({ void: false, addCheck: false });
    const checkId = ws.checks[0]!.id as Id<"requiredChecks">;
    // 無関係者は完了できない
    await expect(cast.stranger.as.mutation(api.checks.complete, { checkId })).rejects.toThrow(
      code("forbidden"),
    );
    expect(await cast.reviewer.as.mutation(api.checks.complete, { checkId, note: "OK" })).toBe(
      "done",
    );
    await expect(cast.reviewer.as.mutation(api.checks.complete, { checkId })).rejects.toThrow(
      code("check_already_done"),
    );

    // 指摘 → 担当者指定 → 本文訂正（本人のみ）
    const threadId = (await cast.reviewer.as.mutation(api.comments.post, {
      revisionId,
      body: "誤字",
      kind: "correction",
      severity: "major",
    })) as Id<"commentThreads">;
    await cast.creator.as.mutation(api.comments.assign, { threadId, assigneeId: cast.manager.id });
    await expect(
      cast.creator.as.mutation(api.comments.edit, { threadId, body: "x" }),
    ).rejects.toThrow(code("comment_edit_not_author"));
    await cast.reviewer.as.mutation(api.comments.edit, { threadId, body: "誤字（3 ページ）" });
    const ev = await cast.creator.as.query(api.comments.events, { threadId });
    expect(ev.events.map((e) => e.eventType)).toEqual(["created", "assigned", "edited"]);
    const ws2 = await cast.creator.as.query(api.revisions.get, { revisionId });
    expect(ws2.threads[0]).toMatchObject({ body: "誤字（3 ページ）", editCount: 1 });
    expect(ws2.threads[0]!.assignee?.id).toBe(cast.manager.id);

    // 第 2 版を提出 → 前版の未解決指摘が持越候補 → 持越
    vi.setSystemTime(Date.now() + HOUR);
    const s2 = await submit(t, cast, workId);
    const { revisionId: rid2 } = await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: s2.sessionId,
    });
    const revision2 = rid2 as Id<"revisions">;
    const candidates = await cast.creator.as.query(api.comments.carryCandidates, {
      revisionId: revision2,
    });
    expect(candidates.map((c) => c.id)).toEqual([threadId]);
    expect(candidates[0]!.revisionLabel).toBe("第1版");
    const carried = await cast.creator.as.mutation(api.comments.carryForward, {
      threadId,
      targetRevisionId: revision2,
    });
    expect(
      await cast.creator.as.query(api.comments.carryCandidates, { revisionId: revision2 }),
    ).toEqual([]);
    const ws3 = await cast.creator.as.query(api.revisions.get, { revisionId: revision2 });
    expect(ws3.threads.map((th) => th.id)).toEqual([carried]);
    expect(ws3.threads[0]).toMatchObject({ carriedFromThreadId: threadId, resolution: "open" });

    // 誤提出の無効化（理由必須・受付中のみ）
    await expect(
      cast.creator.as.mutation(api.submissions.voidRevision, {
        revisionId: revision2,
        reason: " ",
      }),
    ).rejects.toThrow(code("revision_void_reason_required"));
    await expect(
      cast.reviewer.as.mutation(api.submissions.voidRevision, {
        revisionId: revision2,
        reason: "x",
      }),
    ).rejects.toThrow(code("forbidden"));
    await cast.creator.as.mutation(api.submissions.voidRevision, {
      revisionId: revision2,
      reason: "別作品のファイルを提出した",
    });
    await expect(
      cast.creator.as.mutation(api.submissions.voidRevision, { revisionId, reason: "x" }),
    ).rejects.toThrow(code("revision_void_not_allowed"));
    // 無効化後の次版は欠番にならず第 3 版
    const s3 = await submit(t, cast, workId);
    const r3 = await cast.creator.as.mutation(api.submissions.confirm, { sessionId: s3.sessionId });
    expect(r3.sequence).toBe(3);

    // 期限リマインド: 第 3 版の割当者に 1 回だけ
    await cast.manager.as.mutation(api.reviews.assign, {
      revisionId: r3.revisionId as Id<"revisions">,
      reviewerIds: [cast.reviewer.id],
      reviewType: "general",
    });
    expect(await t.mutation(internal.revisions.remindDeadlines, {})).toBe(1);
    expect(await t.mutation(internal.revisions.remindDeadlines, {})).toBe(0);
    const notes = await cast.reviewer.as.query(api.notifications.list, {});
    expect(notes.filter((n) => n.kind === "deadline_approaching")).toHaveLength(1);
    const unread = await cast.reviewer.as.query(api.notifications.unreadCount, {});
    await cast.reviewer.as.mutation(api.notifications.markRead, {
      notificationId: notes[0]!.id as Id<"notifications">,
    });
    expect(await cast.reviewer.as.query(api.notifications.unreadCount, {})).toBe(unread - 1);
    await cast.reviewer.as.mutation(api.notifications.markAllRead, {});
    expect(await cast.reviewer.as.query(api.notifications.unreadCount, {})).toBe(0);
    // 他人の通知は既読にできない
    await expect(
      cast.manager.as.mutation(api.notifications.markRead, {
        notificationId: notes[0]!.id as Id<"notifications">,
      }),
    ).rejects.toThrow(code("forbidden"));

    // 放置セッションの清掃: 期限切れ open セッションだけ abandoned
    const stale = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: Date.now() + 48 * HOUR,
      changeSummary: "放置",
      focusNotes: "",
      items: [{ fileName: "z.pdf", mimeType: "application/pdf", type: "pdf", role: "source" }],
    });
    expect(await t.mutation(internal.submissions.expireSessions, {})).toBe(0);
    vi.setSystemTime(stale.expiresAt + 1);
    expect(await t.mutation(internal.submissions.expireSessions, {})).toBe(1);
    const staleState = await cast.creator.as.query(api.submissions.get, {
      sessionId: stale.sessionId as Id<"uploadSessions">,
    });
    expect(staleState.session.state).toBe("abandoned");

    // ユーザー検索は一般利用者も可（表示名・メールのみ）
    const found = await cast.creator.as.query(api.users.search, { text: "review" });
    expect(found).toEqual([
      { id: cast.reviewer.id, name: "reviewer", email: "reviewer@example.invalid" },
    ]);
  });

  it("v1 清掃: abandoned セッションの R2 オブジェクトを Hono が取りに来て削除記録する（共有秘密で認証）", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast);
    const stale = await submit(t, cast, workId); // 検証済みだが確定しない
    vi.setSystemTime(Date.now() + 48 * HOUR);
    expect(await t.mutation(internal.submissions.expireSessions, {})).toBe(1);

    const prev = process.env.MF100_CLEANUP_SECRET;
    process.env.MF100_CLEANUP_SECRET = "test-cleanup-secret-0123456789";
    try {
      const unauthorized = await t.fetch("/internal/upload-orphans", {
        headers: { Authorization: "Bearer wrong" },
      });
      expect(unauthorized.status).toBe(404);
      const headers = { Authorization: `Bearer ${process.env.MF100_CLEANUP_SECRET}` };
      const listed = (await (
        await t.fetch("/internal/upload-orphans?limit=10", { headers })
      ).json()) as {
        items: Array<{ itemId: string; objectKey: string }>;
      };
      expect(listed.items.map((i) => i.itemId).sort()).toEqual(stale.items.map((i) => i.id).sort());
      const purged = (await (
        await t.fetch("/internal/upload-orphans/purged", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ itemIds: listed.items.map((i) => i.itemId) }),
        })
      ).json()) as { purged: number };
      expect(purged.purged).toBe(2);
      const again = (await (await t.fetch("/internal/upload-orphans", { headers })).json()) as {
        items: unknown[];
      };
      expect(again.items).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.MF100_CLEANUP_SECRET;
      else process.env.MF100_CLEANUP_SECRET = prev;
    }
    // 確定済みの版の実体は対象外: 新しい提出を確定しても一覧に出ない
    const ok = await submit(t, cast, workId);
    await cast.creator.as.mutation(api.submissions.confirm, { sessionId: ok.sessionId });
    expect(await t.mutation(internal.submissions.listOrphanObjects, {})).toEqual([]);
  });
});
