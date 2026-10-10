import { query } from "./_generated/server";
import { optionalUser } from "./lib/principal.ts";

/** ログイン中のユーザー。未ログインなら null（UI はサインイン画面へ）。 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalUser(ctx);
    if (!auth) return null;
    const { user } = auth;
    return {
      id: user._id,
      name: user.name ?? "",
      email: user.email ?? null,
      isSystemAdmin: user.isSystemAdmin ?? false,
      source: user.source ?? null,
      mock: process.env.NOGIKU_MOCK_ENABLED === "true",
    };
  },
});
