import {
  decideRuleProposal,
  decideRuleProposals,
  getRuleBook,
  getRuleHistory,
  importRules,
  listRuleProposals,
  loadCategories,
  proposeRule,
  resolveRulesForWork,
  saveCategory,
  saveRule,
  setCategoryManager,
  setRuleEnabled,
} from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { resolveUsers } from "./users.ts";
import {
  object,
  vProposalContext,
  vProposalKind,
  vProposalStatus,
  vRuleCategoryFields,
  vRuleDraft,
  vRuleException,
} from "./validators.ts";

// apps/convex/convex/notation.ts の写し。
// 権限の判定はすべて application の use case で行う（ここは引数の検証と受け渡しだけ）

export const notation = {
  /** ルール一覧と自分の役割（管理画面・ブラウザ内の検査で使う） */
  "notation:ruleBook": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => {
      const book = await getRuleBook(ctx.db, ctx.principal!);
      const users = resolveUsers(
        ctx.sql,
        book.managers.map((m) => m.userId),
      );
      return {
        ...book,
        managers: book.managers.map((m) => ({ ...m, user: users.get(m.userId)! })),
      };
    },
  }),

  "notation:ruleHistory": query({
    auth: "user",
    args: object({ ruleId: z.string() }),
    handler: async (ctx, { ruleId }) => {
      const list = await getRuleHistory(ctx.db, ctx.principal!, ruleId);
      const users = resolveUsers(
        ctx.sql,
        list.map((h) => h.actorId),
      );
      return list.map((h) => ({ ...h, actor: users.get(h.actorId)! }));
    },
  }),

  "notation:proposals": query({
    auth: "user",
    args: object({ status: vProposalStatus.nullable() }),
    handler: async (ctx, args) => {
      const list = await listRuleProposals(ctx.db, ctx.principal!, args);
      const users = resolveUsers(ctx.sql, [
        ...list.map((p) => p.proposedBy),
        ...list.flatMap((p) => (p.decidedBy ? [p.decidedBy] : [])),
      ]);
      return list.map((p) => ({
        ...p,
        proposer: users.get(p.proposedBy)!,
        decider: p.decidedBy ? users.get(p.decidedBy)! : null,
      }));
    },
  }),

  /** カテゴリの一覧だけ（制作物のフォームのカテゴリ選択用）。ルール本体・管理者は読まない */
  "notation:categories": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => loadCategories(ctx.db),
  }),

  /** 制作物に今適用されるルールの組 */
  "notation:rulesForWork": query({
    auth: "user",
    args: object({ workId: z.string() }),
    handler: async (ctx, { workId }) => resolveRulesForWork(ctx.db, ctx.principal!, workId),
  }),

  "notation:save": mutation({
    auth: "user",
    args: object({
      rule: vRuleDraft,
      expectedRevision: z.number().optional(),
      reason: z.string().optional(),
    }),
    handler: async (ctx, args) => saveRule(ctx.db, ctx.principal!, args),
  }),

  "notation:setEnabled": mutation({
    auth: "user",
    args: object({ ruleId: z.string(), enabled: z.boolean(), reason: z.string().optional() }),
    handler: async (ctx, args) => setRuleEnabled(ctx.db, ctx.principal!, args),
  }),

  "notation:upsertCategory": mutation({
    auth: "user",
    args: object(vRuleCategoryFields),
    handler: async (ctx, args) => {
      await saveCategory(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  "notation:setManager": mutation({
    auth: "user",
    args: object({ userId: z.string(), categoryCode: z.string(), assigned: z.boolean() }),
    handler: async (ctx, args) => {
      await setCategoryManager(ctx.db, ctx.principal!, args);
      return null;
    },
  }),

  "notation:importBatch": mutation({
    auth: "user",
    args: object({
      rules: z.array(vRuleDraft),
      notes: z.array(object({ categoryCode: z.string(), text: z.string() })),
      overwrite: z.boolean(),
      reason: z.string().optional(),
    }),
    handler: async (ctx, args) => importRules(ctx.db, ctx.principal!, args),
  }),

  "notation:propose": mutation({
    auth: "user",
    args: object({
      kind: vProposalKind,
      categoryCode: z.string(),
      ruleId: z.string().optional(),
      title: z.string(),
      correct: z.array(z.string()),
      incorrect: z.array(z.string()),
      patterns: z.array(z.string()).optional(),
      exceptions: z.array(vRuleException).optional(),
      reason: z.string(),
      context: vProposalContext.optional(),
    }),
    handler: async (ctx, args) => {
      const r = await proposeRule(ctx.db, ctx.principal!, args);
      return { proposalId: r.proposal.id, merged: r.merged };
    },
  }),

  "notation:decide": mutation({
    auth: "user",
    args: object({
      proposalId: z.string(),
      decision: z.enum(["approve", "reject"]),
      note: z.string().optional(),
      edited: vRuleDraft.optional(),
    }),
    handler: async (ctx, args) => {
      const p = await decideRuleProposal(ctx.db, ctx.principal!, args);
      return { status: p.status, ruleId: p.resultRuleId ?? null };
    },
  }),

  "notation:decideMany": mutation({
    auth: "user",
    args: object({
      proposalIds: z.array(z.string()),
      decision: z.enum(["approve", "reject"]),
      note: z.string().optional(),
    }),
    handler: async (ctx, args) => decideRuleProposals(ctx.db, ctx.principal!, args),
  }),
} satisfies Record<string, FnDef>;
