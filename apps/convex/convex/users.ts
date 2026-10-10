import { v } from "convex/values";
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
      .map((u) => ({ id: u._id, name: u.name ?? "", email: u.email ?? null }));
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
