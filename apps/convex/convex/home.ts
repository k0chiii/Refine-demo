import {
  isWorkPinned,
  listSubmitTargets,
  recordWorkOpened,
  resetDashboardLayout,
  saveDashboardLayout,
  setWorkPinned,
} from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { listMyWorks } from "./works.ts";

/**
 * ホーム（自分だけのダッシュボード W-26）と「版を提出」（L-15）のアダプタ。業務の判定は application / domain。
 */

/** FAB「版を提出」の候補: 自分が版を提出できる進行中の制作物（納期順） */
export const submitTargets = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    const works = await listMyWorks(ctx.db, principal);
    return runUseCase(() => listSubmitTargets(createReadContext(ctx.db), principal, works));
  },
});

/** 節の構成を保存する（並び・表示・件数）。知らない ID は捨てる */
export const saveLayout = mutation({
  args: {
    widgets: v.array(
      v.object({ id: v.string(), visible: v.boolean(), limit: v.union(v.number(), v.null()) }),
    ),
  },
  handler: async (ctx, { widgets }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await saveDashboardLayout(createAppContext(ctx), principal, widgets.slice(0, 50));
      return null;
    });
  },
});

/** 既定（役割で自動）の構成に戻す */
export const resetLayout = mutation({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await resetDashboardLayout(createAppContext(ctx), principal);
      return null;
    });
  },
});

/** ホームにピン留め／外す */
export const setPinned = mutation({
  args: { workId: v.string(), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => setWorkPinned(createAppContext(ctx), principal, args));
  },
});

export const pinned = query({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => isWorkPinned(createReadContext(ctx.db), principal, workId));
  },
});

/** エディタを開いたら「最近開いた制作物」に記録する */
export const recordOpened = mutation({
  args: { workId: v.string() },
  handler: async (ctx, { workId }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await recordWorkOpened(createAppContext(ctx), principal, workId);
      return null;
    });
  },
});
