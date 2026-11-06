import type { Doc, Id } from "../_generated/dataModel";
import type { DatabaseReader } from "../_generated/server";
import { personDisplayName, PROOFREADER_ID, PROOFREADER_NAME } from "@mf100/domain";

export interface UserSummary {
  id: string;
  name: string;
  email: string | null;
}

/** 画面・通知に出す名前（ふりがな。無い人は漢字の名前。利用者指示 2026-10-21。domain の personDisplayName） */
export function userDisplayName(user: Pick<Doc<"users">, "name" | "hurigana">): string {
  return personDisplayName(user);
}

/** 名簿の行（application の PersonProfile）。漢字の名前は検索のためだけに添える */
export function personProfileOf(user: Doc<"users">) {
  return {
    id: user._id as string,
    name: userDisplayName(user),
    email: user.email ?? null,
    nameKanji: user.name ?? null,
  };
}

export function summarizeUser(user: Doc<"users"> | null, fallbackId: string): UserSummary {
  return {
    id: fallbackId,
    name: (user && userDisplayName(user)) || "（不明なユーザー）",
    email: user?.email ?? null,
  };
}

export async function resolveUsers(
  db: DatabaseReader,
  ids: Iterable<string>,
): Promise<Map<string, UserSummary>> {
  const out = new Map<string, UserSummary>();
  const lookups: Array<Promise<void>> = [];
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
    // 利用者の読み取りは互いに独立なので並べて待つ（人数分だけ順番に往復しない）
    lookups.push(
      db
        .get("users", id as Id<"users">)
        .catch(() => null)
        .then((doc) => {
          out.set(id, summarizeUser(doc, id));
        }),
    );
  }
  await Promise.all(lookups);
  return out;
}
