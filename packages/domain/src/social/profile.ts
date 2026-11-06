import { DomainError } from "../shared/DomainError.ts";
import { socialPlatforms, type SocialPlatform } from "./post.ts";

/**
 * SNS のアカウント（本体の設定。システム管理者が登録し、制作物ごとにどれを使うか割り当てる）。
 * 投稿のプレビューに出す見た目（表示名・ユーザー名・アイコン・自己紹介・認証バッジ・数字）だけを持つ。
 * 実際の SNS には接続しない（ログイン情報やトークンは持たない）。
 */
export interface SocialProfile {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  username: string;
  /** アイコン（縮小した画像の data URL。プレビュー用） */
  avatar?: string;
  bio?: string;
  verified: boolean;
  /** プロフィール画面の数字（プレビューの見かけ。任意） */
  stats?: { posts?: number; followers?: number; following?: number };
  updatedAt: number;
  updatedBy: string;
}

export type SocialProfileInput = Omit<SocialProfile, "id" | "updatedAt" | "updatedBy">;

/** 登録できる数の上限（運用は 3 程度の想定。ポリシー値） */
export const SOCIAL_PROFILE_MAX = 10;
export const SOCIAL_AVATAR_MAX_CHARS = 80_000;

const USERNAME: Record<SocialPlatform, RegExp> = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
};

const invalid = (field: string, reason: string) =>
  new DomainError("social_profile_invalid", { field, reason });

/** 入力を確かめて整える（ユーザー名は各サービスの規則、アイコンは画像の data URL で上限あり） */
export function validateSocialProfile(input: SocialProfileInput): SocialProfileInput {
  if (!socialPlatforms.includes(input.platform)) throw invalid("platform", "unknown");
  const displayName = input.displayName.trim();
  if (!displayName || Array.from(displayName).length > 50) throw invalid("displayName", "length");
  const username = input.username.trim().replace(/^@/, "");
  if (!USERNAME[input.platform].test(username)) throw invalid("username", "format");
  const bio = input.bio?.trim() ?? "";
  if (Array.from(bio).length > 160) throw invalid("bio", "length");
  if (input.avatar !== undefined) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.avatar))
      throw invalid("avatar", "format");
    if (input.avatar.length > SOCIAL_AVATAR_MAX_CHARS) throw invalid("avatar", "too_large");
  }
  const stats: SocialProfile["stats"] = {};
  for (const k of ["posts", "followers", "following"] as const) {
    const n = input.stats?.[k];
    if (n === undefined) continue;
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000_000) throw invalid(`stats.${k}`, "range");
    stats[k] = n;
  }
  return {
    platform: input.platform,
    displayName,
    username,
    verified: input.verified === true,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    ...(bio ? { bio } : {}),
    ...(Object.keys(stats).length ? { stats } : {}),
  };
}

/** 投稿の記録に写すアカウントの見た目（版ごとに固定する） */
export function accountOfProfile(p: SocialProfile): {
  displayName: string;
  username: string;
  avatar?: string;
  verified?: boolean;
} {
  return {
    displayName: p.displayName,
    username: p.username,
    ...(p.avatar ? { avatar: p.avatar } : {}),
    ...(p.verified ? { verified: true } : {}),
  };
}
