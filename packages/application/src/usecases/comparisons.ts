import { DomainError, isAllowed, type ManualPair, type Principal } from "@mf100/domain";
import type { AlignmentOverride, AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

/** 比較する 2 つの添付が同じ制作物の版に属することを確かめ、制作物を返す（他の制作物の添付を混ぜない） */
async function loadPair(ctx: AppContext, leftArtifactId: string, rightArtifactId: string) {
  const [l, r] = await Promise.all([
    ctx.artifacts.findById(leftArtifactId),
    ctx.artifacts.findById(rightArtifactId),
  ]);
  if (!l || !r) throw new DomainError("forbidden", { reason: "artifact_not_found" });
  const [lr, rr] = await Promise.all([
    ctx.revisions.findById(l.revisionId),
    ctx.revisions.findById(r.revisionId),
  ]);
  if (!lr || !rr || lr.workId !== rr.workId)
    throw new DomainError("forbidden", { reason: "artifact_work_mismatch" });
  return lr.workId;
}

/** 手動のページ対応を読む（閲覧できる人なら誰でも） */
export async function getAlignmentOverride(
  ctx: AppContext,
  principal: Principal,
  leftArtifactId: string,
  rightArtifactId: string,
): Promise<AlignmentOverride | null> {
  const workId = await loadPair(ctx, leftArtifactId, rightArtifactId);
  await loadAuthorizedWork(ctx, principal, workId, "work.view");
  return ctx.alignments.find(leftArtifactId, rightArtifactId);
}

const MAX_PAIRS = 2000;

/**
 * 手動のページ対応を保存する。校正に関わる人（指摘できる人・版を提出できる人）だけ。
 * 元のアンカー（指摘の座標）は版ごとの元ファイル基準のままで、この対応は表示にだけ使う。
 */
export async function saveAlignmentOverride(
  ctx: AppContext,
  principal: Principal,
  input: { leftArtifactId: string; rightArtifactId: string; pairs: ManualPair[] },
): Promise<void> {
  const workId = await loadPair(ctx, input.leftArtifactId, input.rightArtifactId);
  const { work, grants } = await loadAuthorizedWork(ctx, principal, workId, "work.view");
  const may =
    isAllowed("revision.submit", { work, grants, principal }) ||
    isAllowed("comment.post", { work, grants, principal });
  if (!may) throw new DomainError("forbidden", { reason: "alignment_edit" });
  if (input.pairs.length > MAX_PAIRS)
    throw new DomainError("forbidden", { reason: "too_many_pairs" });
  for (const p of input.pairs) {
    const ok = (v: number | null) => v === null || (Number.isInteger(v) && v >= 1 && v <= 10_000);
    if (!ok(p.left) || !ok(p.right) || (p.left === null && p.right === null))
      throw new DomainError("forbidden", { reason: "invalid_pair" });
  }
  // 同じページを 2 回使わない
  const ls = input.pairs.map((p) => p.left).filter((x) => x !== null);
  const rs = input.pairs.map((p) => p.right).filter((x) => x !== null);
  if (new Set(ls).size !== ls.length || new Set(rs).size !== rs.length)
    throw new DomainError("forbidden", { reason: "duplicate_page" });
  const current = await ctx.alignments.find(input.leftArtifactId, input.rightArtifactId);
  const row = {
    workId,
    leftArtifactId: input.leftArtifactId,
    rightArtifactId: input.rightArtifactId,
    pairs: input.pairs,
    updatedBy: principal.userId,
    updatedAt: ctx.clock.now(),
  };
  if (current) await ctx.alignments.update({ ...row, id: current.id });
  else await ctx.alignments.insert(row);
}
