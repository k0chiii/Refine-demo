import { getDocumentDraft, listWritableWorks, saveDocumentDraft } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";
import { listMyWorks } from "./works.ts";

/**
 * 文章の下書き（エディタ `/works/:id/write`）。読むのは閲覧権限、書くのは版を提出できる人。
 * 権限のない利用者には作品の存在も返さない（A-01。ユースケースが forbidden を返す）。
 */
export const get = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const { draft, canEdit } = await getDocumentDraft(
        createReadContext(ctx.db),
        principal,
        workId,
      );
      if (!draft) return { draft: null, canEdit };
      const users = await resolveUsers(ctx.db, [draft.updatedBy]);
      return {
        canEdit,
        draft: {
          title: draft.title,
          content: draft.content,
          text: draft.text,
          version: draft.version,
          updatedAt: draft.updatedAt,
          updatedBy: users.get(draft.updatedBy) ?? null,
        },
      };
    });
  },
});

/** 自動保存。版番号が食い違えば version_conflict（他の人の保存を上書きしない） */
export const save = mutation({
  args: {
    workId: v.id("works"),
    title: v.string(),
    content: v.string(),
    text: v.string(),
    baseVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => saveDocumentDraft(createAppContext(ctx.db), principal, args));
  },
});

/**
 * エディタの入口（サイドレールの「エディタ」）: 自分の担当で、いま書ける制作物と下書きの要約。
 * 自分が関わる制作物（listMyWorks）から、版を提出できて進行中のものだけ。本文そのものは返さない。
 */
export const writable = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    const works = await listMyWorks(ctx.db, principal);
    return runUseCase(async () => {
      const list = await listWritableWorks(createReadContext(ctx.db), principal, works);
      const users = await resolveUsers(
        ctx.db,
        list.flatMap((w) => (w.draft ? [w.draft.updatedBy] : [])),
      );
      return list.map((w) => ({
        ...w,
        draft: w.draft ? { ...w.draft, updatedBy: users.get(w.draft.updatedBy) ?? null } : null,
      }));
    });
  },
});
