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
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";
import {
  vProposalContext,
  vProposalKind,
  vProposalStatus,
  vRuleCategoryFields,
  vRuleDraft,
  vRuleException,
} from "./lib/validators.ts";

/**
 * 表記統一（ルール・カテゴリ・カテゴリ管理者・取り込み・変更提案）。
 * 権限の判定はすべて application のユースケースで行う（ここは引数の検証と受け渡しだけ）。
 */

/** ルール一覧と自分の役割（管理画面・ブラウザ内の検査で使う） */
export const ruleBook = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const book = await getRuleBook(createReadContext(ctx.db), principal);
      const users = await resolveUsers(
        ctx.db,
        book.managers.map((m) => m.userId),
      );
      return {
        ...book,
        managers: book.managers.map((m) => ({ ...m, user: users.get(m.userId)! })),
      };
    });
  },
});

/**
 * カテゴリの一覧だけ（制作物のフォームのカテゴリ選択用）。ルール本体・管理者は読まない。
 * ruleBook はルール全件を読むので、カテゴリだけ欲しい画面（制作物の登録・編集）がそれを購読すると、
 * ルールが 1 件変わるたびに開いているフォームの購読が再実行され、全件を読み直す
 */
export const categories = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return runUseCase(() => loadCategories(createReadContext(ctx.db)));
  },
});

export const ruleHistory = query({
  args: { ruleId: v.string() },
  handler: async (ctx, { ruleId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const list = await getRuleHistory(createReadContext(ctx.db), principal, ruleId);
      const users = await resolveUsers(
        ctx.db,
        list.map((h) => h.actorId),
      );
      return list.map((h) => ({ ...h, actor: users.get(h.actorId)! }));
    });
  },
});

/** 制作物に今適用されるルールの組 */
export const rulesForWork = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => resolveRulesForWork(createReadContext(ctx.db), principal, workId));
  },
});

export const save = mutation({
  args: {
    rule: vRuleDraft,
    expectedRevision: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => saveRule(createAppContext(ctx), principal, args));
  },
});

export const setEnabled = mutation({
  args: { ruleId: v.string(), enabled: v.boolean(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => setRuleEnabled(createAppContext(ctx), principal, args));
  },
});

export const upsertCategory = mutation({
  args: vRuleCategoryFields,
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await saveCategory(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

export const setManager = mutation({
  args: { userId: v.string(), categoryCode: v.string(), assigned: v.boolean() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await setCategoryManager(createAppContext(ctx), principal, args);
      return null;
    });
  },
});

export const importBatch = mutation({
  args: {
    rules: v.array(vRuleDraft),
    notes: v.array(v.object({ categoryCode: v.string(), text: v.string() })),
    overwrite: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => importRules(createAppContext(ctx), principal, args));
  },
});

export const propose = mutation({
  args: {
    kind: vProposalKind,
    categoryCode: v.string(),
    ruleId: v.optional(v.string()),
    title: v.string(),
    correct: v.array(v.string()),
    incorrect: v.array(v.string()),
    patterns: v.optional(v.array(v.string())),
    exceptions: v.optional(v.array(vRuleException)),
    reason: v.string(),
    context: v.optional(vProposalContext),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const r = await proposeRule(createAppContext(ctx), principal, args);
      return { proposalId: r.proposal.id, merged: r.merged };
    });
  },
});

export const proposals = query({
  args: { status: v.union(vProposalStatus, v.null()) },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const list = await listRuleProposals(createReadContext(ctx.db), principal, args);
      const users = await resolveUsers(ctx.db, [
        ...list.map((p) => p.proposedBy),
        ...list.flatMap((p) => (p.decidedBy ? [p.decidedBy] : [])),
      ]);
      return list.map((p) => ({
        ...p,
        proposer: users.get(p.proposedBy)!,
        decider: p.decidedBy ? users.get(p.decidedBy)! : null,
      }));
    });
  },
});

export const decide = mutation({
  args: {
    proposalId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    note: v.optional(v.string()),
    edited: v.optional(vRuleDraft),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const p = await decideRuleProposal(createAppContext(ctx), principal, args);
      return { status: p.status, ruleId: p.resultRuleId ?? null };
    });
  },
});

export const decideMany = mutation({
  args: {
    proposalIds: v.array(v.string()),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => decideRuleProposals(createAppContext(ctx), principal, args));
  },
});
