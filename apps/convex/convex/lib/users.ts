import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { PROOFREADER_ID, PROOFREADER_NAME } from "@mf100/domain";

export interface UserSummary {
  id: string;
  name: string;
  email: string | null;
}

export function summarizeUser(user: Doc<"users"> | null, fallbackId: string): UserSummary {
  return { id: fallbackId, name: user?.name ?? "（不明なユーザー）", email: user?.email ?? null };
}

export async function resolveUsers(
  db: DatabaseReader,
  ids: Iterable<string>,
): Promise<Map<string, UserSummary>> {
  const out = new Map<string, UserSummary>();
  for (const id of new Set(ids)) {
    if (id === "system") {
      out.set(id, { id, name: "システム", email: null });
      continue;
    }
    if (id.startsWith("bot:")) {
      // システムの投稿者（自動校正）。users テーブルには存在しない
      out.set(id, { id, name: id === PROOFREADER_ID ? PROOFREADER_NAME : "システム", email: null });
      continue;
    }
    const doc = await db.get("users", id as Id<"users">).catch(() => null);
    out.set(id, summarizeUser(doc, id));
  }
  return out;
}
