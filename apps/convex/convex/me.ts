import {
  hasOrgPermission,
  orgPermissions,
  parseAvatarConfig,
  validateAvatarConfig,
} from "@mf100/domain";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { runUseCase } from "./lib/errors.ts";
import { optionalUser, requireUser } from "./lib/principal.ts";
import { userDisplayName } from "./lib/users.ts";
import { vAvatarConfig } from "./lib/validators.ts";

/** ログイン中のユーザー。未ログインなら null（UI はサインイン画面へ）。 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalUser(ctx);
    if (!auth) return null;
    const { user, principal } = auth;
    return {
      id: user._id,
      name: userDisplayName(user),
      email: user.email ?? null,
      isSystemAdmin: user.isSystemAdmin ?? false,
      /** 制作物を登録する権限（Nogiku の組織権限 works:create）。登録の入口は、これに canAssignApprovers も要る。認可はサーバーで別に確かめる */
      canCreateWorks: hasOrgPermission(principal, orgPermissions.worksCreate),
      /** 校了者を決められるか（Nogiku の組織権限 approvers:assign）。登録の入口・一覧と編集の校了者の編集を出すかに使う */
      canAssignApprovers: hasOrgPermission(principal, orgPermissions.approversAssign),
      source: user.source ?? null,
      mock: process.env.NOGIKU_MOCK_ENABLED === "true",
      /** 本人が選んだアバター（無ければ null。メールから決まる絵） */
      avatar: parseAvatarConfig(user.avatar),
    };
  },
});

/**
 * 自分のアバターを選ぶ（Humation。利用者指示 2026-10-17）。変えられるのは本人だけ。
 * null で設定を消し、メール（または ID）から決まる絵に戻す。形の検証と正規化は domain。
 */
export const setAvatar = mutation({
  args: { avatar: v.union(vAvatarConfig, v.null()) },
  handler: async (ctx, { avatar }) => {
    const { user } = await requireUser(ctx);
    return runUseCase(async () => {
      const normalized = validateAvatarConfig(avatar);
      await ctx.db.patch(user._id, { avatar: normalized ?? undefined });
      return normalized;
    });
  },
});
