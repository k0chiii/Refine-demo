import {
  checkRegisteredPlanInfoInText,
  isAccepting,
  PLAN_INFO_BOT_ID,
  planInfoCheckFingerprint,
  type CommentThread,
  type Principal,
  type Revision,
  type Work,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/** 版の本文（下書き。無ければ空） */
async function revisionText(ctx: AppContext, work: Work): Promise<string> {
  const draft = await ctx.documents.findByWork(work.id);
  return draft?.text?.trim() ?? "";
}

async function acceptingRevisionForWork(ctx: AppContext, work: Work): Promise<Revision | null> {
  const revisions = await ctx.revisions.listByWork(work.id);
  let found: Revision | null = null;
  for (const revision of revisions) {
    if (!isAccepting(revision)) continue;
    if (!found || revision.sequence > found.sequence) found = revision;
  }
  return found;
}

/**
 * 登録済み企画情報と版本文を照合し、不一致は warn-only の bot スレッドで知らせる（71B）。
 * 制作者が直す。AI は Convex action 側で本文を渡して呼ぶ。
 */
export async function syncPlanInfoWarnings(
  ctx: AppContext,
  principal: Principal,
  workId: string,
  opts: { revisionId?: string; textOverride?: string } = {},
): Promise<{ created: number; skipped: string | null }> {
  const { work } = await loadAuthorizedWork(ctx, principal, workId, "work.view");
  const info = work.registeredPlanInfo;
  if (!info || Object.keys(info).length === 0)
    return { created: 0, skipped: "no_registered_plan_info" };
  const revision =
    (opts.revisionId ? await ctx.revisions.findById(opts.revisionId) : null) ??
    (await acceptingRevisionForWork(ctx, work));
  if (!revision || !isAccepting(revision)) return { created: 0, skipped: "no_accepting_revision" };
  if (work.lifecycle === "finalized") return { created: 0, skipped: "work_finalized" };
  const text = opts.textOverride ?? (await revisionText(ctx, work));
  if (!text) return { created: 0, skipped: "no_text" };

  const items = checkRegisteredPlanInfoInText(text, info);
  const failures = items.filter((i) => !i.ok);
  if (failures.length === 0) return { created: 0, skipped: null };

  const threads = await ctx.threads.listByRevision(revision.id);
  const existing = new Set(
    threads.map((t) => t.origin?.fingerprint).filter((x): x is string => !!x),
  );
  const now = ctx.clock.now();
  // 作る指摘を先に集め、まとめて足す（件数の数え直しは最後に 1 回）
  const toCreate: Array<{ data: Omit<CommentThread, "id">; field: string }> = [];
  for (const item of failures) {
    const fingerprint = planInfoCheckFingerprint(item.field, item.registered);
    if (existing.has(fingerprint)) continue;
    const data: Omit<CommentThread, "id"> = {
      revisionId: revision.id,
      authorId: PLAN_INFO_BOT_ID,
      body: item.message,
      kind: "correction",
      severity: "minor",
      resolution: "open",
      createdAt: now,
      origin: {
        kind: "bot",
        detector: "ai",
        ruleId: "plan-info",
        ruleRevision: 0,
        runId: "plan-info",
        fingerprint,
        confidence: "medium",
        needsReview: true,
        original: item.registered,
        suggestion: "",
        textSource: "document",
      },
    };
    toCreate.push({ data, field: item.field });
    existing.add(fingerprint);
  }
  const inserted = await ctx.threads.insertMany(toCreate.map((c) => c.data));
  for (const [i, thread] of inserted.entries())
    await ctx.threads.appendEvent({
      threadId: thread.id,
      eventType: "created",
      actorId: PLAN_INFO_BOT_ID,
      payload: { source: "plan_info_check", field: toCreate[i]!.field },
      createdAt: now,
    });
  const created = toCreate.length;
  return { created, skipped: null };
}
