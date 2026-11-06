import { deleteTeam, importTeams, listTeams, saveTeam } from "@mf100/application";
import { z } from "zod";
import { mutation, query, type FnDef } from "./define.ts";
import { object, vBureauCode } from "./validators.ts";

// apps/convex/convex/teams.ts の写し（importDirectory は利用者の名簿を読む画面向けの読みなので別の単位）。
// 登録・変更・削除・取り込みはシステム管理者だけ（use case が確かめる）

export const teams = {
  /** 一覧はサインインしていれば誰でも（制作物の主管担当・制作担当の表示と選択、一覧の担当別の表示で使う） */
  "teams:list": query({
    auth: "user",
    args: object({}),
    handler: async (ctx) => listTeams(ctx.db, ctx.principal!),
  }),

  "teams:save": mutation({
    auth: "user",
    args: object({
      id: z.string().optional(),
      name: z.string(),
      kind: z.enum(["bureau", "team"]),
      parentId: z.string().optional(),
      order: z.number().optional(),
      /** 省略は「変えない」、null・空で外す */
      code: z.union([vBureauCode, z.string(), z.null()]).optional(),
      emoji: z.string().nullable().optional(),
      memberIds: z.array(z.string()).nullable().optional(),
    }),
    handler: async (ctx, args) => {
      const team = await saveTeam(ctx.db, ctx.principal!, args);
      return team.id;
    },
  }),

  "teams:remove": mutation({
    auth: "user",
    args: object({ id: z.string() }),
    handler: async (ctx, { id }) => {
      await deleteTeam(ctx.db, ctx.principal!, id);
      return null;
    },
  }),

  /**
   * CSV での取り込み。画面が parseTeamCsv で読んで確認した行（と、所属する人を照合した ID）を送る。
   * 無い局・担当だけを作る（冪等）
   */
  "teams:importBatch": mutation({
    auth: "user",
    args: object({
      rows: z.array(
        object({
          /** CSV の行番号（memberIds の対応に使う） */
          line: z.number().optional(),
          bureau: z.string(),
          team: z.string().nullable(),
          order: z.number().optional(),
          emoji: z.string().optional(),
          /** 照合済みの所属する人の ID */
          memberIds: z.array(z.string()).optional(),
          /** parseTeamCsv の行をそのまま送れるように受け取るだけ（照合前の書き方。使わない） */
          members: z.array(z.string()).optional(),
        }),
      ),
    }),
    handler: async (ctx, { rows }) => {
      const members = new Map<number, readonly string[]>();
      const lines = rows.map((r, i) => {
        const line = r.line ?? i + 1;
        if (r.memberIds && r.memberIds.length > 0) members.set(line, r.memberIds);
        return {
          line,
          bureau: r.bureau,
          team: r.team,
          ...(r.order !== undefined ? { order: r.order } : {}),
          ...(r.emoji ? { emoji: r.emoji } : {}),
          members: [],
        };
      });
      return importTeams(ctx.db, ctx.principal!, lines, members);
    },
  }),
} satisfies Record<string, FnDef>;
