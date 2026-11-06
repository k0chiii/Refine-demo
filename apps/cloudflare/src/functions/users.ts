import {
  DomainError,
  parseAvatarConfig,
  personDisplayName,
  personMatchesText,
  PROOFREADER_ID,
  PROOFREADER_NAME,
  type AvatarConfig,
} from "@mf100/domain";
import { z } from "zod";
import type { Sql } from "../sqlite/sql.ts";
import { query, type FnCtx, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

// apps/convex/convex/users.ts と lib/users.ts の写し。users の行は id と doc(JSON)。
// 下の helper（resolveUsers / userDisplayName / takeUsers / requireAdmin / UserDoc）は他のモジュールも使う。本命の置き場は merge で寄せる

export interface UserSummary {
  id: string;
  name: string;
  email: string | null;
}

/** users.doc のうち、ここで読む項目 */
export interface UserDoc {
  subject?: string;
  name?: string;
  hurigana?: string;
  email?: string;
  generation?: number;
  isSystemAdmin?: boolean;
  avatar?: unknown;
}

/**
 * 管理者だけの関数の入口。Convex は unauthenticated を投げるが、サインイン済みの人への 401 は「入り直せ」に読まれるので forbidden にする
 */
export function requireAdmin(ctx: FnCtx): void {
  if (!ctx.principal!.isSystemAdmin) throw new DomainError("forbidden");
}

/** 画面・通知に出す名前（ふりがな。無い人は漢字の名前。domain の personDisplayName） */
export const userDisplayName = (user: Pick<UserDoc, "name" | "hurigana">): string =>
  personDisplayName(user);

/** users の行を先頭から limit 件（Convex の `.take(n)` = 作成順）。id も添える */
export function takeUsers(sql: Sql, limit: number): Array<UserDoc & { id: string }> {
  return sql
    .exec("SELECT id, doc FROM users ORDER BY rowid LIMIT ?", limit)
    .map((r) => ({ ...(JSON.parse(r.doc as string) as UserDoc), id: r.id as string }));
}

/** ID の集まりから users の doc を引く（無い ID は入らない） */
function userDocsOf(sql: Sql, ids: readonly string[]): Map<string, UserDoc> {
  const out = new Map<string, UserDoc>();
  if (ids.length === 0) return out;
  for (const r of sql.exec(
    "SELECT id, doc FROM users WHERE id IN (SELECT value FROM json_each(?))",
    JSON.stringify(ids),
  ))
    out.set(r.id as string, JSON.parse(r.doc as string) as UserDoc);
  return out;
}

const isStored = (id: string) => id !== "system" && !id.startsWith("bot:");

/**
 * ID → 名前・メール。system / bot: は users に無い固定の名前。消えた人・知らない ID は「（不明なユーザー）」
 * ponytail: 返す Map は引数の順。Convex は system / bot を先に入れてから利用者を並べる（画面は ID で引くので順に依らない）
 */
export function resolveUsers(sql: Sql, ids: Iterable<string>): Map<string, UserSummary> {
  const unique = [...new Set(ids)];
  const found = userDocsOf(sql, unique.filter(isStored));
  const out = new Map<string, UserSummary>();
  for (const id of unique) {
    if (id === "system") out.set(id, { id, name: "システム", email: null });
    else if (id.startsWith("bot:"))
      out.set(id, { id, name: id === PROOFREADER_ID ? PROOFREADER_NAME : "システム", email: null });
    else {
      const user = found.get(id);
      out.set(id, {
        id,
        name: (user && userDisplayName(user)) || "（不明なユーザー）",
        email: user?.email ?? null,
      });
    }
  }
  return out;
}

export const users = {
  /**
   * ユーザー選択 UI 用の検索。一度でもログインした人（subject がある）を、名前（ふりがな・漢字）・メールで探し、
   * ふりがなの順に並べる。返すのは表示名・メール・代だけ（権限や管理者フラグは返さない）
   */
  "users:search": query({
    auth: "user",
    args: object({ text: z.string(), limit: z.number().optional() }),
    handler: async (ctx, { text, limit }) =>
      takeUsers(ctx.sql, 500)
        .filter((u) => u.subject !== undefined)
        .filter((u) => personMatchesText(u, text))
        .map((u) => ({ u, name: userDisplayName(u) }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
        .slice(0, Math.min(limit ?? 20, 50))
        .map(({ u, name }) => ({
          id: u.id,
          name,
          email: u.email ?? null,
          /** 代（同名の人を見分ける手がかり） */
          generation: u.generation ?? null,
        })),
  }),

  /** ID 群の表示名解決（選択済みユーザーのチップ表示用） */
  "users:byIds": query({
    auth: "user",
    args: object({ ids: z.array(z.string()) }),
    handler: async (ctx, { ids }) => [...resolveUsers(ctx.sql, ids.slice(0, 100)).values()],
  }),

  /**
   * 画面に出ている人のアバターの設定。各クエリの返り値には混ぜず、画面がいま出している ID だけをまとめて引く。
   * 設定のある人だけ返す
   */
  "users:avatars": query({
    auth: "user",
    args: object({ ids: z.array(z.string()) }),
    handler: async (ctx, { ids }) => {
      const wanted = [...new Set(ids.slice(0, 200))].filter(isStored);
      const docs = userDocsOf(ctx.sql, wanted);
      const out: Array<{ id: string; avatar: AvatarConfig }> = [];
      for (const id of wanted) {
        const avatar = parseAvatarConfig(docs.get(id)?.avatar);
        if (avatar) out.push({ id, avatar });
      }
      return out;
    },
  }),
} satisfies Record<string, FnDef>;
