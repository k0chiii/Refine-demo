import { hasOrgPermission, orgPermissions } from "@mf100/domain";
import { query } from "./_generated/server";
import { optionalUser } from "./lib/principal.ts";

/** ログイン中のユーザー。未ログインなら null（UI はサインイン画面へ）。 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalUser(ctx);
    if (!auth) return null;
    const { user, principal } = auth;
    return {
      id: user._id,
      name: user.name ?? "",
      email: user.email ?? null,
      isSystemAdmin: user.isSystemAdmin ?? false,
      /** 制作物を登録できるか（Nogiku の組織権限 works:create）。登録の入口を出すかに使う。認可はサーバーで別に確かめる */
      canCreateWorks: hasOrgPermission(principal, orgPermissions.worksCreate),
      source: user.source ?? null,
      mock: process.env.NOGIKU_MOCK_ENABLED === "true",
    };
  },
});
