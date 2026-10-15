import { deleteTeam, importTeams, listTeams, saveTeam } from "@mf100/application";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";

/**
 * 組織（局 › 担当）。登録・変更・削除・取り込みはシステム管理者だけ（ユースケースで確認）。
 * 一覧はサインインしていれば誰でも（制作物の主管担当・制作担当の表示と選択、一覧の担当別の表示で使う）。
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => listTeams(createReadContext(ctx.db), principal));
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.string()),
    name: v.string(),
    kind: v.union(v.literal("bureau"), v.literal("team")),
    parentId: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const team = await saveTeam(createAppContext(ctx.db), principal, args);
      return team.id;
    });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await deleteTeam(createAppContext(ctx.db), principal, id);
      return null;
    });
  },
});

/** CSV での取り込み。画面が parseTeamCsv で読んで確認した行を送る。無い局・担当だけを作る（冪等） */
export const importBatch = mutation({
  args: {
    rows: v.array(
      v.object({
        bureau: v.string(),
        team: v.union(v.string(), v.null()),
        order: v.optional(v.number()),
        /** CSV の行番号（parseTeamCsv の行をそのまま送れるように受け取るだけ。使わない） */
        line: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() =>
      importTeams(
        createAppContext(ctx.db),
        principal,
        rows.map(({ bureau, team, order }) => ({
          bureau,
          team,
          ...(order !== undefined ? { order } : {}),
        })),
      ),
    );
  },
});
