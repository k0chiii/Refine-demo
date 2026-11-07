import { getDocumentDraft, loadWorkAllowing, saveDocumentDraft } from "@mf100/application";
import { DomainError, draftFormatFor } from "@mf100/domain";
import { z } from "zod";
import { documentText } from "../collab/documentText.ts";
import {
  advanceSnapshotVersion,
  appendSteps,
  collaborativeDraft,
  enableDraft,
  latestSnapshot,
  latestVersion,
  putSnapshot,
  stepsAfter,
} from "../collab/store.ts";
import { mutation, query, type FnCtx, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/collaboration.ts の写し。@convex-dev/prosemirror-sync の syncApi（getSnapshot / submitSnapshot /
// latestVersion / getSteps / submitSteps）を、部品（component/lib.ts）と同じ意味で SQLite の表に置き換えたもの。
// 画面の useTiptapSync(api.collaboration, workId) が呼ぶ名前・引数・戻りをそのまま満たす。id は制作物の ID（= docId）

/** 閲覧は work.view、書くのは revision.submit（documents:get の canEdit と同じ判定）。文章の媒体で、書くなら進行中だけ */
async function authorize(ctx: FnCtx, id: string, write = false) {
  const principal = ctx.principal!;
  // 職責で足りるなら ACL を読まない（共同編集は保存のたびに呼ばれる）
  const work = await loadWorkAllowing(
    ctx.db,
    principal,
    id,
    write ? "revision.submit" : "work.view",
  );
  if (draftFormatFor(work.mediaType) !== "document")
    throw new DomainError("document_format_mismatch");
  if (write && work.lifecycle !== "active") throw new DomainError("work_not_active");
  return { work, principal };
}

/** 書く側の関門: 認可に加えて、共同編集に切り替え済みであること */
async function authorizeWrite(ctx: FnCtx, id: string) {
  const authorized = await authorize(ctx, id, true);
  const enabled = collaborativeDraft(ctx.sql, id);
  // ponytail: Convex も素の Error。切り替えを忘れた画面のバグなので 500 のまま（業務の失敗ではない）
  if (!enabled) throw new Error("collaboration_not_enabled");
  return { ...authorized, enabled };
}

const id = z.string();
/** ProseMirror の collab の clientID。数も文字列も来る */
const clientId = z.union([z.string(), z.number()]);

export const collaboration = {
  "collaboration:getSnapshot": query({
    auth: "user",
    args: object({ id, version: z.number().optional() }),
    handler: async (ctx, args) => {
      await authorize(ctx, args.id);
      const snapshot = latestSnapshot(ctx.sql, args.id, args.version);
      return snapshot ?? { content: null };
    },
  }),

  "collaboration:submitSnapshot": mutation({
    auth: "user",
    args: object({ id, version: z.number().int(), content: z.string() }),
    handler: async (ctx, args) => {
      const { work, principal, enabled } = await authorizeWrite(ctx, args.id);
      // 版が進んだ snapshot だけ、下書き（documents）にも写す。古い snapshot は上書きしない
      if (args.version > enabled.snapshotVersion) {
        const current = await ctx.db.documents.findByWork(args.id);
        await saveDocumentDraft(ctx.db, principal, {
          workId: args.id,
          title: current?.title ?? work.title,
          content: args.content,
          text: documentText(args.content),
          baseVersion: current?.version ?? 0,
        });
        advanceSnapshotVersion(ctx.sql, args.id, args.version);
      }
      // 同じ版に同じ中身なら冪等。違う中身は 2 つの画面が同じ版を別々に作った（部品は Error で落とす）
      if (!putSnapshot(ctx.sql, args.id, args.version, args.content))
        throw new DomainError("version_conflict", { id: args.id, version: args.version });
      return null;
    },
  }),

  /** 最新の版（ステップがあればその版、無ければ snapshot の版）。文書がまだ無ければ null */
  "collaboration:latestVersion": query({
    auth: "user",
    args: object({ id }),
    handler: async (ctx, args) => {
      await authorize(ctx, args.id);
      return latestVersion(ctx.sql, args.id);
    },
  }),

  /** `version` より後のステップ。追いつくための読み取り */
  "collaboration:getSteps": query({
    auth: "user",
    args: object({ id, version: z.number().int() }),
    handler: async (ctx, args) => {
      await authorize(ctx, args.id);
      const { steps, clientIds } = stepsAfter(ctx.sql, args.id, args.version);
      return { steps, clientIds, version: args.version + steps.length };
    },
  }),

  /**
   * ステップの提出。`version` より後に他の人のステップがあれば、書かずに needs-rebase でそれを返す（画面が自分のステップを
   * 組み直して送り直す）。無ければ追記して synced
   */
  "collaboration:submitSteps": mutation({
    auth: "user",
    args: object({ id, version: z.number().int(), clientId, steps: z.array(z.string()) }),
    handler: async (ctx, args) => {
      await authorizeWrite(ctx, args.id);
      const behind = stepsAfter(ctx.sql, args.id, args.version);
      if (behind.steps.length > 0) return { status: "needs-rebase" as const, ...behind };
      if (args.steps.length === 0) return { status: "synced" as const };
      // 部品はここで検べず、先の版を名乗る送信が版の飛んだ行を作る（誰も読み進められなくなる）。穴を作る前に止める
      const latest = latestVersion(ctx.sql, args.id);
      if (latest !== args.version)
        throw new DomainError("version_conflict", { id: args.id, version: args.version, latest });
      appendSteps(ctx.sql, args.id, args.version, args.clientId, args.steps);
      return { status: "synced" as const };
    },
  }),

  /** 下書きを共同編集に切り替える（snapshot の版 1 に今の下書きを置く）。切り替え済みなら何もしない */
  "collaboration:enable": mutation({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => {
      const { principal } = await authorize(ctx, workId, true);
      if (collaborativeDraft(ctx.sql, workId)) return null;
      const { draft } = await getDocumentDraft(ctx.db, principal, workId);
      const content =
        draft?.content ?? JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
      documentText(content);
      enableDraft(ctx.sql, workId, ctx.now(), principal.userId);
      // 部品の create と同じ: 中身は JSON として読み直してから書く（空白の違いで別の中身にならないように）
      putSnapshot(ctx.sql, workId, 1, JSON.stringify(JSON.parse(content)));
      return null;
    },
  }),
} satisfies Record<string, FnDef>;
