import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { getDocumentDraft, loadAuthorizedWork, saveDocumentDraft } from "@mf100/application";
import { DomainError, draftFormatFor } from "@mf100/domain";
import { v } from "convex/values";
import type { GenericDataModel } from "convex/server";
import { components } from "./_generated/api";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { requireUser } from "./lib/principal.ts";

export const sync = new ProsemirrorSync(components.prosemirrorSync);
async function authorize(ctx: QueryCtx | MutationCtx, id: string, write = false) {
  const { principal } = await requireUser(ctx);
  const { work } = await loadAuthorizedWork(
    createReadContext(ctx.db),
    principal,
    id,
    write ? "revision.submit" : "work.view",
  );
  if (draftFormatFor(work.mediaType) !== "document")
    throw new DomainError("document_format_mismatch");
  if (write && work.lifecycle !== "active") throw new DomainError("work_not_active");
  return { work, principal };
}

/** Same plain-text convention as the writing editor: text blocks and hard breaks use newlines. */
export function documentText(content: string): string {
  if (content.length > 2_000_000) throw new Error("document_too_large");
  const root: unknown = JSON.parse(content);
  let text = "",
    count = 0,
    first = true;
  function walk(value: unknown, depth = 0) {
    if (++count > 50_000 || depth > 100 || !value || typeof value !== "object")
      throw new Error("invalid_document");
    const node = value as { type?: unknown; text?: unknown; content?: unknown };
    if (typeof node.type !== "string") throw new Error("invalid_document");
    if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
      if (!first) text += "\n";
      first = false;
    }
    if (node.type === "text") {
      if (typeof node.text !== "string") throw new Error("invalid_document");
      text += node.text;
    }
    if (node.type === "hardBreak") text += "\n";
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error("invalid_document");
      for (const child of node.content) walk(child, depth + 1);
    }
  }
  if (!root || typeof root !== "object" || (root as { type?: unknown }).type !== "doc")
    throw new Error("invalid_document");
  walk(root);
  return text;
}

export const { getSnapshot, submitSnapshot, latestVersion, getSteps, submitSteps } =
  sync.syncApi<GenericDataModel>({
    // Auth tables currently include explicit optional undefined; narrow only the SDK context boundary.
    checkRead: async (genericCtx, id) => {
      await authorize(genericCtx as unknown as QueryCtx, id);
    },
    checkWrite: async (genericCtx, id) => {
      const ctx = genericCtx as unknown as MutationCtx;
      await authorize(ctx, id, true);
      const enabled = await ctx.db
        .query("collaborativeDrafts")
        .withIndex("by_work", (q) => q.eq("workId", id))
        .unique();
      if (!enabled) throw new Error("collaboration_not_enabled");
    },
    onSnapshot: async (genericCtx, id, content, version) => {
      const ctx = genericCtx as unknown as MutationCtx;
      const { work, principal } = await authorize(ctx, id, true);
      const enabled = await ctx.db
        .query("collaborativeDrafts")
        .withIndex("by_work", (q) => q.eq("workId", id))
        .unique();
      if (!enabled || version <= enabled.snapshotVersion) return;
      const app = createAppContext(ctx);
      const current = await app.documents.findByWork(id);
      await saveDocumentDraft(app, principal, {
        workId: id,
        title: current?.title ?? work.title,
        content,
        text: documentText(content),
        baseVersion: current?.version ?? 0,
      });
      await ctx.db.patch(enabled._id, { snapshotVersion: version });
    },
  });

export const enable = mutation({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await authorize(ctx, workId, true);
    if (
      await ctx.db
        .query("collaborativeDrafts")
        .withIndex("by_work", (q) => q.eq("workId", workId))
        .unique()
    )
      return;
    const { draft } = await getDocumentDraft(createReadContext(ctx.db), principal, workId);
    const content =
      draft?.content ?? JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
    documentText(content);
    await ctx.db.insert("collaborativeDrafts", { workId, snapshotVersion: 1 });
    await sync.create(ctx, workId, JSON.parse(content));
  },
});
