import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { createContext, useContext, useRef } from "react";
import { useDebouncedValue } from "@/lib/useDebouncedValue";

export interface MentionUser {
  id: string;
  name: string;
  email?: string | null;
}

/**
 * メンションの検索先と、候補から選んだ人の名前の控え。
 * 候補の一覧（通常の制作物では全委員 ≤500 人）を画面で丸ごと購読せず、「@」に続けて打った文字でサーバー側に探させる
 * （comments.searchMentionCandidates。名前順・20 人まで。docs/UI_M3E.md §60）。
 * 非公開の制作物では、見られる人の小さな一覧の中から同じ検索で探す。
 * 選んだ人の名前は、投稿するときに本文に「@名前」が残っているか確かめるために控える（{@link activeMentions}）。
 */
export interface MentionDirectory {
  workId: string;
  remember(user: MentionUser): void;
  nameOf(id: string): string | undefined;
}

export function createMentionDirectory(workId: string): MentionDirectory {
  const names = new Map<string, string>();
  return {
    workId,
    remember: (u) => names.set(u.id, u.name),
    nameOf: (id) => names.get(id),
  };
}

/** いま開いている制作物のメンションの検索先（Editor が渡す） */
const MentionContext = createContext<MentionDirectory | null>(null);
export const MentionProvider = MentionContext.Provider;
export const useMentionDirectory = () => useContext(MentionContext);

/** 「@」に続けて打った文字でサーバーに候補を探させる（打っていない間は購読しない） */
export function useMentionSearch(dir: MentionDirectory | null, text: string | null): MentionUser[] {
  // 速く打っているときは打ち止めてから検索する（1 文字ごとに購読を作り直さない）。「@」を打った直後（空の検索語）と閉じたときはすぐ
  const deferred = useDebouncedValue(text, 150, (t) => t === null || t === "");
  const args = dir && deferred !== null ? { workId: dir.workId, text: deferred } : "skip";
  const results = useQuery(api.comments.searchMentionCandidates, args);
  // 次の結果が届くまでは前の候補を出したままにする（打つたびに消えて点滅しない）。閉じたら忘れる
  const last = useRef<MentionUser[]>([]);
  if (text === null) last.current = [];
  else if (results !== undefined) last.current = results;
  return text === null ? [] : (results ?? last.current);
}

/** カーソルの直前が「@よみ」なら、その開始位置と検索語を返す */
export function mentionQueryAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s　(（「])@([^\s　@]{0,20})$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

/** 本文に「@名前」が残っている人だけを返す（消した人には通知しない）。名前は候補から選んだときの控え */
export function activeMentions(
  body: string,
  ids: readonly string[],
  dir: Pick<MentionDirectory, "nameOf">,
): string[] {
  return [...new Set(ids)].filter((id) => {
    const name = dir.nameOf(id);
    return name ? body.includes(`@${name}`) : false;
  });
}

export { renderWithMentions } from "./mentionText";
