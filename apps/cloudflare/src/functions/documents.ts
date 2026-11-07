import { getDocumentDraft, listWritableWorks, saveDocumentDraft } from "@mf100/application";
import { z } from "zod";
import { collaborativeDraft } from "../collab/store.ts";
import { mutation, query, reject, type FnDef } from "./define.ts";
import { activeWorks } from "./home.ts";
import { resolveUsers } from "./users.ts";
import { object, vId } from "./validators.ts";

// apps/convex/convex/documents.ts の写し。文章の下書き（エディタ `/works/:id/write`）。
// 読むのは閲覧権限、書くのは版を提出できる人。権限のない人には制作物の存在も返さない（use case が forbidden）。
// 共同編集に切り替えた下書き（collaborativeDrafts）は collaboration:* が正本なので、ここからは書かせない

export const documents = {
  "documents:get": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => {
      const { draft, canEdit } = await getDocumentDraft(ctx.db, ctx.principal!, workId);
      const collaborative = collaborativeDraft(ctx.sql, workId) !== null;
      if (!draft) return { draft: null, canEdit, collaborative };
      const users = resolveUsers(ctx.sql, [draft.updatedBy]);
      return {
        canEdit,
        collaborative,
        draft: {
          title: draft.title,
          content: draft.content,
          text: draft.text,
          version: draft.version,
          updatedAt: draft.updatedAt,
          updatedBy: users.get(draft.updatedBy) ?? null,
        },
      };
    },
  }),

  /**
   * 自動保存。版番号が食い違えば version_conflict（他の人の保存を上書きしない）。
   * 制作物の媒体・保存済みの下書きと形式が違えば document_format_mismatch（原稿を別の形式で上書きしない）
   */
  "documents:save": mutation({
    auth: "user",
    args: object({
      workId: vId,
      title: z.string(),
      content: z.string(),
      text: z.string(),
      baseVersion: z.number(),
      /** 別の形式の下書きを置き換える明示的な操作（媒体を変えた制作物など） */
      replaceFormat: z.boolean().optional(),
    }),
    handler: async (ctx, args) => {
      // Convex も権限の確認より先に見る（切り替え済みかどうかは、書けない人にも分かってよい情報）
      if (collaborativeDraft(ctx.sql, args.workId))
        throw reject("collaborative_draft_requires_sync");
      return saveDocumentDraft(ctx.db, ctx.principal!, args);
    },
  }),

  /**
   * エディタの入口（サイドレールの「エディタ」）: 自分の担当で、いま書ける制作物と下書きの要約。
   * 版を提出できて進行中のものだけ。本文そのものは返さない
   */
  "documents:writable": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => {
      const list = await listWritableWorks(ctx.db, ctx.principal!, await activeWorks(ctx));
      const users = resolveUsers(
        ctx.sql,
        list.flatMap((w) => (w.draft ? [w.draft.updatedBy] : [])),
      );
      return list.map((w) => ({
        ...w,
        draft: w.draft ? { ...w.draft, updatedBy: users.get(w.draft.updatedBy) ?? null } : null,
      }));
    },
  }),
} satisfies Record<string, FnDef>;
