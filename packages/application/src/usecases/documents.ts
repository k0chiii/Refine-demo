import {
  DomainError,
  type DocumentDraft,
  type DraftSaveInput,
  isAllowed,
  nextDraft,
  type Principal,
  type Work,
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
 * - 媒体に合わない形式・保存済みと違う形式は document_format_mismatch（置き換えは replaceFormat の明示操作だけ）
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
  // 形式は制作物の媒体と保存済みの下書きに合わせる（文章の原稿を投稿で上書きしない）
  const next = nextDraft(
    current,
    input,
    principal.userId,
    ctx.clock.now(),
    work.id,
    work.mediaType,
  );
  if (current) await ctx.documents.update({ ...next, id: current.id });
  else await ctx.documents.insert(next);
  return { version: next.version, updatedAt: next.updatedAt };
}

export interface WritableWork {
  workId: string;
  title: string;
  mediaType: Work["mediaType"];
  category: string;
  deadlineAt: number | null;
  /** 下書き（まだ無ければ null）。本文そのものは返さない */
  draft: { title: string; chars: number; updatedAt: number; updatedBy: string } | null;
}

/**
 * エディタの入口（サイドレールの「エディタ」）: 自分の担当で、いま書ける制作物。
 * 書けるのは版を提出できる人（制作者・主管担当など）で、制作物が進行中のものだけ（getDocumentDraft の canEdit と同じ判定）。
 * 並びは、最近書いた下書きが上、次に締切の近い順、最後に名前順。
 */
export async function listWritableWorks(
  ctx: AppContext,
  principal: Principal,
  works: readonly Work[],
): Promise<WritableWork[]> {
  const out: WritableWork[] = [];
  for (const work of works) {
    if (work.lifecycle !== "active") continue;
    const grants = await ctx.acl.listByWork(work.id);
    if (!isAllowed("revision.submit", { work, grants, principal })) continue;
    const draft = await ctx.documents.findByWork(work.id);
    out.push({
      workId: work.id,
      title: work.title,
      mediaType: work.mediaType,
      category: work.category,
      deadlineAt: work.deadlineAt ?? null,
      draft: draft
        ? {
            title: draft.title,
            chars: Array.from(draft.text.replace(/\s/g, "")).length,
            updatedAt: draft.updatedAt,
            updatedBy: draft.updatedBy,
          }
        : null,
    });
  }
  return out.sort(
    (a, b) =>
      (b.draft?.updatedAt ?? 0) - (a.draft?.updatedAt ?? 0) ||
      (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity) ||
      a.title.localeCompare(b.title, "ja"),
  );
}
