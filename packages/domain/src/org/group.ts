import { toHiragana } from "../account/personName.ts";
import { DomainError } from "../shared/DomainError.ts";
import type { UserId } from "../shared/ids.ts";
import type { Instant } from "../shared/time.ts";
import { teamNameKey } from "./team.ts";

/**
 * メンバーのグループ（利用者指示 2026-10-21「メンバーに対してグループという概念を作り、校正者や @メンションに
 * グループのまとまりで割り当てられるようにしたい」）。
 * 局・担当（org/team.ts）とは別の、人の集まりの名前（例: 「こうせいはん」）。制作物の閲覧の権限には関わらない。
 * - 校正者: グループを選ぶと、そのときの所属する人をまとめて割り当てる（割り当ては人ごと）
 * - メンション: 「@グループ名」で、所属する人のうちその制作物を見られる人にまとめて知らせる（comment/mentions.ts）
 * 作る・変える・消すのはシステム管理者（担当と同じ）。一覧はサインインしていれば誰でも。
 */
export interface MemberGroup {
  id: string;
  name: string;
  /** 所属する人（重なりなし。並びは選んだ順） */
  memberIds: UserId[];
  /** 並び順（小さいほど上） */
  order: number;
  updatedAt: Instant;
  updatedBy: UserId;
}

export interface MemberGroupInput {
  name: string;
  memberIds: readonly string[];
  /** 省略すると最後 */
  order?: number | undefined;
}

/** 作れるグループの数の上限（ポリシー値） */
export const MEMBER_GROUP_MAX = 200;
/** グループの名前の長さの上限（文字数） */
export const MEMBER_GROUP_NAME_MAX = 30;
/** 1 つのグループに入れられる人数の上限（ポリシー値。メンションの一斉通知の大きさもこれで決まる） */
export const MEMBER_GROUP_MEMBER_MAX = 100;

const invalid = (field: string, reason: string, extra = {}) =>
  new DomainError("group_invalid", { field, reason, ...extra });

/**
 * 入力を確かめて整える。
 * - 名前: 前後の空白を除いて 1 文字以上・上限まで。「@」は使えない（メンションの書き方と紛れる）
 * - 同じ名前（全角半角・大文字小文字・空白のゆれを無視）のグループがある（自分は除く） → group_duplicate
 * - 所属する人: 空の ID は不可、重なりは 1 人に。上限まで（0 人でもよい）
 * - 並び順を省略すると最後
 */
export function validateMemberGroup(
  input: MemberGroupInput,
  existing: readonly MemberGroup[],
  selfId?: string,
): { name: string; memberIds: UserId[]; order: number } {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name === "") throw invalid("name", "required");
  if (Array.from(name).length > MEMBER_GROUP_NAME_MAX) throw invalid("name", "too_long");
  if (/[@＠]/.test(name)) throw invalid("name", "has_at");
  const others = existing.filter((g) => g.id !== selfId);
  const key = teamNameKey(name);
  if (others.some((g) => teamNameKey(g.name) === key))
    throw new DomainError("group_duplicate", { name });
  const memberIds: UserId[] = [];
  for (const raw of input.memberIds) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id === "") throw invalid("memberIds", "blank_id");
    if (!memberIds.includes(id)) memberIds.push(id);
  }
  if (memberIds.length > MEMBER_GROUP_MEMBER_MAX)
    throw invalid("memberIds", "too_many", { max: MEMBER_GROUP_MEMBER_MAX });
  let order: number;
  if (input.order !== undefined) {
    if (!Number.isInteger(input.order) || Math.abs(input.order) > 1_000_000)
      throw invalid("order", "not_integer");
    order = input.order;
  } else {
    order = others.reduce((max, g) => Math.max(max, g.order), 0) + 1;
  }
  return { name, memberIds, order };
}

/** 表示の順（並び順 → 名前） */
export function sortMemberGroups<G extends Pick<MemberGroup, "name" | "order">>(
  groups: readonly G[],
): G[] {
  return [...groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));
}

/** グループの名前で探す（名前の途中でも当たる。全角半角・カタカナとひらがなは区別しない）。空の検索語はすべて */
export function searchMemberGroups<G extends Pick<MemberGroup, "name" | "order">>(
  groups: readonly G[],
  text: string,
): G[] {
  const fold = (s: string) => toHiragana(teamNameKey(s)).replace(/\s+/g, "");
  const q = fold(text);
  return sortMemberGroups(groups.filter((g) => q === "" || fold(g.name).includes(q)));
}

/**
 * グループの所属する人をまとめる（重なりは 1 人に。グループの順 → 所属の順）。
 * 知らないグループの ID は飛ばす（呼び出し側が確かめる）
 */
export function expandMemberGroups(
  groupIds: readonly string[],
  groups: readonly Pick<MemberGroup, "id" | "memberIds">[],
): UserId[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: UserId[] = [];
  for (const gid of groupIds)
    for (const id of byId.get(gid)?.memberIds ?? []) if (!out.includes(id)) out.push(id);
  return out;
}
