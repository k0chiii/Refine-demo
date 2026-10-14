import {
  DomainError,
  isAccepting,
  isAllowed,
  planBotThreads,
  proofreadableType,
  PROOFREADER_ID,
  runStatusOf,
  validateAnchor,
  type Artifact,
  type CommentThread,
  type Principal,
  type ProofreadingRun,
  type ProofreadSegment,
  type Revision,
  type TextSource,
  type Work,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";
import { rulesOfSnapshot } from "./notation.ts";
import { notify } from "./notifications.ts";

/**
 * 提出時の自動校正。
 * 1. 提出確定のトランザクションで実行（run）を pending で作る（失敗しても提出は取り消さない。作るだけなので失敗しない）
 * 2. 提出者などのブラウザが添付ごとに「担当」を取り（期限付き）、PDF.js / OCR / 平文で文字を取り出して送る
 * 3. サーバーは版に記録したルールの版で照合し直し、指摘を通常のスレッドとして作る（指紋で重複しない）
 * 4. 失敗した添付は理由を残し、再試行できる
 */

const LEASE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 5;

/** 提出確定の中から呼ぶ（権限確認済み） */
export async function createProofreadingRun(
  ctx: AppContext,
  work: Work,
  revision: Revision,
  artifacts: readonly Artifact[],
): Promise<ProofreadingRun | null> {
  if (!revision.notationSnapshot) return null;
  const now = ctx.clock.now();
  const targets = artifacts.filter((a) => a.role === "source" || a.role === "preview");
  const list: ProofreadingRun["artifacts"] = targets.map((a) => ({
    artifactId: a.id,
    status: proofreadableType(a.type) ? "pending" : "skipped",
    findings: 0,
  }));
  return ctx.proofreadingRuns.insert({
    workId: work.id,
    revisionId: revision.id,
    status: runStatusOf(list),
    snapshotHash: revision.notationSnapshot.hash,
    artifacts: list,
    attempts: 1,
    createdAt: now,
    updatedAt: now,
  });
}

/** 文字を送れる人: 版を提出できる人か、指摘できる人（指摘できない人に自動の指摘を作らせない） */
async function loadForRun(ctx: AppContext, principal: Principal, runId: string) {
  const run = await ctx.proofreadingRuns.findById(runId);
  if (!run) throw new DomainError("forbidden", { reason: "run_not_found" });
  const { work, grants } = await loadAuthorizedWork(ctx, principal, run.workId, "work.view");
  const authz = { work, grants, principal };
  if (!isAllowed("revision.submit", authz) && !isAllowed("comment.post", authz))
    throw new DomainError("forbidden", { reason: "proofread_not_allowed" });
  const revision = await ctx.revisions.findById(run.revisionId);
  if (!revision) throw new DomainError("forbidden", { reason: "revision_not_found" });
  return { run, work, revision };
}

export interface RunView {
  run: ProofreadingRun | null;
  /** この人の端末で検査を進められるか */
  canRun: boolean;
}

export async function getProofreadingRun(
  ctx: AppContext,
  principal: Principal,
  revisionId: string,
): Promise<RunView> {
  const revision = await ctx.revisions.findById(revisionId);
  if (!revision) throw new DomainError("forbidden", { revisionId });
  const { work, grants } = await loadAuthorizedWork(ctx, principal, revision.workId, "work.view");
  const authz = { work, grants, principal };
  const run = await ctx.proofreadingRuns.findByRevision(revisionId);
  return {
    run,
    canRun:
      !!run &&
      work.lifecycle !== "finalized" &&
      isAccepting(revision) &&
      (isAllowed("revision.submit", authz) || isAllowed("comment.post", authz)),
  };
}

/** 添付の検査を担当する（同時に 2 台で同じ添付を処理しない）。期限切れの担当は引き継げる */
export async function claimProofreadArtifact(
  ctx: AppContext,
  principal: Principal,
  input: { runId: string; artifactId: string },
): Promise<{ claimed: boolean }> {
  const { run } = await loadForRun(ctx, principal, input.runId);
  const now = ctx.clock.now();
  const a = run.artifacts.find((x) => x.artifactId === input.artifactId);
  if (!a) throw new DomainError("forbidden", { reason: "artifact_not_in_run" });
  const free = a.status === "pending" || (a.status === "running" && (a.leaseUntil ?? 0) < now);
  if (!free) return { claimed: false };
  const artifacts = run.artifacts.map((x) =>
    x.artifactId === a.artifactId
      ? { ...x, status: "running" as const, leaseUntil: now + LEASE_MS }
      : x,
  );
  await ctx.proofreadingRuns.update({
    ...run,
    artifacts,
    status: runStatusOf(artifacts),
    updatedAt: now,
  });
  return { claimed: true };
}

const expectedSegment: Record<string, ProofreadSegment["kind"]> = {
  document: "text",
  pdf: "page",
  image: "image",
};

/**
 * 取り出した文字を受け取り、サーバーでルールを当ててスレッドを作る。
 * ブラウザが「指摘」を送ることはできない（送れるのは文字と位置だけ）。
 */
export async function submitProofreadSegments(
  ctx: AppContext,
  principal: Principal,
  input: { runId: string; artifactId: string; segments: ProofreadSegment[] },
): Promise<{ created: number; duplicates: number; truncated: boolean; skipped?: string }> {
  const { run, work, revision } = await loadForRun(ctx, principal, input.runId);
  const now = ctx.clock.now();
  const entry = run.artifacts.find((x) => x.artifactId === input.artifactId);
  if (!entry) throw new DomainError("forbidden", { reason: "artifact_not_in_run" });
  if (entry.status === "done" || entry.status === "skipped")
    return { created: 0, duplicates: 0, truncated: false, skipped: "already_done" };
  const artifact = await ctx.artifacts.findById(input.artifactId);
  if (!artifact || artifact.revisionId !== revision.id)
    throw new DomainError("anchor_artifact_mismatch", { artifactId: input.artifactId });
  const kind = expectedSegment[artifact.type];
  if (!kind || input.segments.some((s) => s.kind !== kind))
    throw new DomainError("forbidden", { reason: "segment_kind_mismatch" });

  const finish = async (patch: Partial<ProofreadingRun["artifacts"][number]>) => {
    const fresh = (await ctx.proofreadingRuns.findById(run.id)) ?? run;
    const artifacts = fresh.artifacts.map((x) => {
      if (x.artifactId !== input.artifactId) return x;
      const { leaseUntil: _l, ...rest } = x;
      return { ...rest, ...patch };
    });
    const status = runStatusOf(artifacts);
    await ctx.proofreadingRuns.update({ ...fresh, artifacts, status, updatedAt: now });
    return { before: fresh.status, after: status, artifacts };
  };

  // 受付が終わった版・校了済みの制作物には自動の指摘も作らない（人と同じ条件）
  if (work.lifecycle === "finalized" || !isAccepting(revision)) {
    await finish({ status: "skipped", error: "受付が終わったため検査しませんでした" });
    return { created: 0, duplicates: 0, truncated: false, skipped: "not_accepting" };
  }
  if (!revision.notationSnapshot) {
    await finish({ status: "skipped", error: "表記統一のカテゴリが選ばれていません" });
    return { created: 0, duplicates: 0, truncated: false, skipped: "no_rules" };
  }
  const rules = await rulesOfSnapshot(ctx, revision.notationSnapshot);
  const { planned, truncated } = planBotThreads(artifact.id, input.segments, rules);
  const existing = new Set(
    (await ctx.threads.listByRevision(revision.id))
      .map((t) => t.origin?.fingerprint)
      .filter((x): x is string => !!x),
  );
  let created = 0;
  let duplicates = 0;
  for (const p of planned) {
    if (existing.has(p.fingerprint)) {
      duplicates++;
      continue;
    }
    try {
      validateAnchor(p.anchor);
    } catch {
      continue; // 位置が不正（壊れた矩形など）なものは作らない
    }
    const data: Omit<CommentThread, "id"> = {
      revisionId: revision.id,
      artifactId: artifact.id,
      authorId: PROOFREADER_ID,
      body: p.body,
      kind: "correction",
      severity: p.severity,
      anchor: p.anchor,
      resolution: "open",
      createdAt: now,
      origin: { ...p.origin, runId: run.id },
    };
    const thread = await ctx.threads.insert(data);
    await ctx.threads.appendEvent({
      threadId: thread.id,
      eventType: "created",
      actorId: PROOFREADER_ID,
      payload: { runId: run.id, submittedBy: principal.userId },
      createdAt: now,
    });
    existing.add(p.fingerprint);
    created++;
  }
  const source: TextSource = kind === "text" ? "document" : kind === "page" ? "pdf_text" : "ocr";
  const res = await finish({
    status: "done",
    findings: created + duplicates,
    source,
    ...(truncated ? { error: "長いため一部だけを検査しました" } : {}),
  });
  if (res.before !== "done" && res.after === "done") {
    const total = res.artifacts.reduce((n, a) => n + a.findings, 0);
    if (total > 0)
      await notify(ctx, work.creatorIds, null, {
        kind: "auto_proofread_done",
        title: `自動校正: ${total} 件の表記の指摘（${work.title}）`,
        body: "校正画面の「自動校正」で確認できます。自動で解決済みにはなりません。",
        workId: work.id,
        revisionId: revision.id,
      });
  }
  return { created, duplicates, truncated };
}

/** 端末で処理できなかった（読み込めない・OCR の失敗など）。提出は取り消さない */
export async function failProofreadArtifact(
  ctx: AppContext,
  principal: Principal,
  input: { runId: string; artifactId: string; error: string },
): Promise<void> {
  const { run } = await loadForRun(ctx, principal, input.runId);
  const artifacts = run.artifacts.map((x) => {
    if (x.artifactId !== input.artifactId || x.status === "done" || x.status === "skipped")
      return x;
    const { leaseUntil: _l, ...rest } = x;
    return { ...rest, status: "failed" as const, error: input.error.slice(0, 300) };
  });
  await ctx.proofreadingRuns.update({
    ...run,
    artifacts,
    status: runStatusOf(artifacts),
    updatedAt: ctx.clock.now(),
  });
}

/** 失敗した添付をもう一度検査待ちにする */
export async function retryProofreadingRun(
  ctx: AppContext,
  principal: Principal,
  input: { runId: string },
): Promise<void> {
  const { run } = await loadForRun(ctx, principal, input.runId);
  if (run.attempts >= MAX_ATTEMPTS)
    throw new DomainError("forbidden", { reason: "too_many_attempts" });
  const artifacts = run.artifacts.map((x) => {
    if (x.status !== "failed") return x;
    const { error: _e, ...rest } = x;
    return { ...rest, status: "pending" as const };
  });
  await ctx.proofreadingRuns.update({
    ...run,
    artifacts,
    attempts: run.attempts + 1,
    status: runStatusOf(artifacts),
    updatedAt: ctx.clock.now(),
  });
}
