import {
  canManageGroups,
  hasOrgPermission,
  orgPermissions,
  parseAvatarConfig,
  personDisplayName,
} from "@mf100/domain";
import { query, type FnDef } from "./define.ts";
import { object } from "./validators.ts";

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
      };
      return {
        id: principal.userId,
        name: personDisplayName({ name: user.name, hurigana: user.hurigana }),
        email: user.email ?? null,
        isSystemAdmin: principal.isSystemAdmin,
        canCreateWorks: hasOrgPermission(principal, orgPermissions.worksCreate),
        canAssignApprovers: hasOrgPermission(principal, orgPermissions.approversAssign),
        canManageGroups: canManageGroups(principal),
        source: null,
        mock: false,
        avatar: parseAvatarConfig(user.avatar),
      };
    },
  }),
} satisfies Record<string, FnDef>;
