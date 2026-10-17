import { parseAvatarConfig, type AvatarConfig } from "@mf100/domain";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireUser } from "./lib/principal.ts";
import { resolveUsers } from "./lib/users.ts";

/**
 * ユーザー選択 UI 用の検索（v1）。サインイン済みの利用者なら誰でも、
 * 一度でもログインした Nogiku ユーザー（＝委員）を名前・メールで検索できる。
 * 返すのは表示名とメールのみ（権限や管理者フラグは返さない）。
 */
export const search = query({
  args: { text: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { text, limit }) => {
    await requireUser(ctx);
    const q = text.trim().toLowerCase();
    const users = await ctx.db.query("users").take(500);
    return users
      .filter((u) => u.nogikuSubject !== undefined)
      .filter((u) => q === "" || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ja"))
      .slice(0, Math.min(limit ?? 20, 50))
      .map((u) => ({
        id: u._id,
        name: u.name ?? "",
        email: u.email ?? null,
        /** 代（Notion のユーザ DB「代」。同名の人を見分ける手がかり） */
        generation: u.generation ?? null,
      }));
  },
});

/** ID 群の表示名解決（選択済みユーザーのチップ表示用）。 */
export const byIds = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    await requireUser(ctx);
    const users = await resolveUsers(ctx.db, ids.slice(0, 100));
    return [...users.values()];
  },
});

/**
 * 画面に出ている人のアバターの設定（Humation。利用者指示 2026-10-17）。
 * アバターは多くの画面（コメント・FB・メンション候補・管理）に出るので、各クエリの返り値には混ぜず、
 * 画面がいま出している ID だけをまとめて引く（1 画面 1 購読）。設定のある人だけ返す。
 */
export const avatars = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    await requireUser(ctx);
    const out: Array<{ id: string; avatar: AvatarConfig }> = [];
    for (const id of new Set(ids.slice(0, 200))) {
      if (id === "system" || id.startsWith("bot:")) continue;
      const doc = await ctx.db.get("users", id as Id<"users">).catch(() => null);
      const avatar = parseAvatarConfig(doc?.avatar);
      if (avatar) out.push({ id, avatar });
    }
    return out;
  },
});
