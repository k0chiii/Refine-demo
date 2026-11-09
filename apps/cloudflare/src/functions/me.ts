import {
  canManageGroups,
  hasOrgPermission,
  orgPermissions,
  parseAvatarConfig,
  personDisplayName,
  validateAvatarConfig,
} from "@mf100/domain";
import { mutation, query, type FnDef } from "./define.ts";
import { object, vAvatarConfig } from "./validators.ts";

export const me = {
  /** ログイン中のユーザー。未ログインなら null（UI はサインイン画面へ）。smoke と画面が自分の ID を知る入口 */
  "me:me": query({
    auth: "optional",
    args: object({}),
    handler: async (ctx) => {
      const { principal } = ctx;
      if (!principal) return null;
      const [row] = ctx.sql.exec("SELECT doc FROM users WHERE id = ?", principal.userId);
      const user = JSON.parse((row?.doc as string | undefined) ?? "{}") as {
        name?: string;
        hurigana?: string;
        email?: string;
        avatar?: unknown;
        source?: string;
      };
      return {
        id: principal.userId,
        name: personDisplayName({ name: user.name, hurigana: user.hurigana }),
        email: user.email ?? null,
        isSystemAdmin: principal.isSystemAdmin,
        canCreateWorks: hasOrgPermission(principal, orgPermissions.worksCreate),
        canAssignApprovers: hasOrgPermission(principal, orgPermissions.approversAssign),
        canManageGroups: canManageGroups(principal),
        source: user.source ?? null,
        mock: (ctx.env.NOGIKU_MOCK_ENABLED as string | undefined) === "true",
        avatar: parseAvatarConfig(user.avatar),
      };
    },
  }),

  /**
   * 自分のアバターを選ぶ。変えられるのは本人だけ（主体の行しか書かない）。
   * null で設定を消し、メール（または ID）から決まる絵に戻す。形の検証と正規化は domain
   */
  "me:setAvatar": mutation({
    auth: "user",
    args: object({ avatar: vAvatarConfig.nullable() }),
    handler: async (ctx, { avatar }) => {
      const normalized = validateAvatarConfig(avatar);
      if (normalized === null)
        ctx.sql.exec(
          "UPDATE users SET doc = json_remove(doc, '$.avatar') WHERE id = ?",
          ctx.userId!,
        );
      else
        ctx.sql.exec(
          "UPDATE users SET doc = json_set(doc, '$.avatar', json(?)) WHERE id = ?",
          JSON.stringify(normalized),
          ctx.userId!,
        );
      return normalized;
    },
  }),
} satisfies Record<string, FnDef>;
