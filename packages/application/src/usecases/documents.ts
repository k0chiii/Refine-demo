import {
  DomainError,
  type DocumentDraft,
  type DraftSaveInput,
  isAllowed,
  nextDraft,
  type Principal,
} from "@mf100/domain";
import type { AppContext } from "../ports.ts";
import { loadAuthorizedWork } from "../shared.ts";

export interface DocumentDraftView {
  draft: DocumentDraft | null;
  /** 書けるか（版を提出できる人＝制作者・主管担当など、かつ制作物が進行中） */
  canEdit: boolean;
}

/** 文章の下書きを読む。閲覧権限があれば読めるが、書けるのは版を提出できる人だけ */
export async function getDocumentDraft(
  ctx: AppContext,
  principal: Principal,
  workId: string,
): Promise<DocumentDraftView> {
  const { work, grants } = await loadAuthorizedWork(ctx, principal, workId, "work.view");
  const draft = await ctx.documents.findByWork(work.id);
  const canEdit =
    work.lifecycle === "active" && isAllowed("revision.submit", { work, grants, principal });
  return { draft, canEdit };
}

export interface SaveDocumentDraftInput extends DraftSaveInput {
  workId: string;
}

/**
 * 下書きを保存する（自動保存から数秒おきに呼ばれる）。
 * - 書けるのは版を提出できる人だけ。進行中でない制作物には書けない
 * - 他の人が先に保存していたら version_conflict（共同編集は後続。§3.2）
 * 自動保存のたびに監査ログを残すと量が多すぎるので、監査は「版として提出」の側（提出のユースケース）で残す。
 */
export async function saveDocumentDraft(
  ctx: AppContext,
  principal: Principal,
  input: SaveDocumentDraftInput,
): Promise<{ version: number; updatedAt: number }> {
  const { work } = await loadAuthorizedWork(ctx, principal, input.workId, "revision.submit");
  if (work.lifecycle !== "active") throw new DomainError("work_not_active", { workId: work.id });
  const current = await ctx.documents.findByWork(work.id);
  const next = nextDraft(current, input, principal.userId, ctx.clock.now(), work.id);
  if (current) await ctx.documents.update({ ...next, id: current.id });
  else await ctx.documents.insert(next);
  return { version: next.version, updatedAt: next.updatedAt };
}
