import { deleteTeam, importTeams, listTeams, saveTeam } from "@mf100/application";
import { normalizePersonKey, type DirectoryUser } from "@mf100/domain";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { createAppContext, createReadContext } from "./lib/adapters.ts";
import { runUseCase } from "./lib/errors.ts";
import { requireUser } from "./lib/principal.ts";
import { vBureauCode } from "./lib/validators.ts";

/**
 * 組織（局 › 担当）。登録・変更・削除・取り込みはシステム管理者だけ（ユースケースで確認）。
 * 一覧はサインインしていれば誰でも（制作物の主管担当・制作担当の表示と選択、一覧の担当別の表示で使う）。
 * 局のコード・絵文字・Google Drive フォルダ・所属する人は Notion の担当 DB に揃えた項目（docs/NOTION_ALIGNMENT.md）。
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
    /** 省略は「変えない」、null・空で外す */
    code: v.optional(v.union(vBureauCode, v.string(), v.null())),
    emoji: v.optional(v.union(v.string(), v.null())),
    driveFolderUrl: v.optional(v.union(v.string(), v.null())),
    memberIds: v.optional(v.union(v.array(v.string()), v.null())),
  },
  handler: async (ctx, args) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      const team = await saveTeam(createAppContext(ctx), principal, args);
      return team.id;
    });
  },
});

export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(async () => {
      await deleteTeam(createAppContext(ctx), principal, id);
      return null;
    });
  },
});

/**
 * CSV での取り込み。画面が parseTeamCsv で読んで確認した行（と、所属する人を照合した ID）を送る。
 * 無い局・担当だけを作る（冪等）
 */
export const importBatch = mutation({
  args: {
    rows: v.array(
      v.object({
        /** CSV の行番号（memberIds の対応に使う） */
        line: v.optional(v.number()),
        bureau: v.string(),
        team: v.union(v.string(), v.null()),
        order: v.optional(v.number()),
        emoji: v.optional(v.string()),
        driveFolderUrl: v.optional(v.string()),
        /** 照合済みの所属する人の ID */
        memberIds: v.optional(v.array(v.string())),
        /** parseTeamCsv の行をそのまま送れるように受け取るだけ（照合前の書き方と知らせ。使わない） */
        members: v.optional(v.array(v.string())),
        notes: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, { rows }) => {
    const { principal } = await requireUser(ctx);
    return runUseCase(() => {
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
          ...(r.driveFolderUrl ? { driveFolderUrl: r.driveFolderUrl } : {}),
          members: [],
          notes: [],
        };
      });
      return importTeams(createAppContext(ctx), principal, lines, members);
    });
  },
});

/**
 * 担当の CSV の「ユーザ」（所属する人）の照合に使う利用者（CSV に書かれたメールアドレス・名前に当たる人だけ）。
 * システム管理者だけが引ける（組織の管理は管理者だけ）
 */
export const importDirectory = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }): Promise<DirectoryUser[]> => {
    const { principal } = await requireUser(ctx);
    if (!principal.isSystemAdmin) return [];
    const wanted = new Set(keys.slice(0, 2000).map(normalizePersonKey));
    if (wanted.size === 0) return [];
    const users = await ctx.db.query("users").take(5000);
    return users
      .filter((u) => u.nogikuSubject !== undefined)
      .filter(
        (u) =>
          wanted.has(normalizePersonKey(u.name ?? "")) ||
          (u.email !== undefined && wanted.has(normalizePersonKey(u.email))),
      )
      .map((u) => ({ id: u._id, name: u.name ?? "", email: u.email ?? null }));
  },
});
