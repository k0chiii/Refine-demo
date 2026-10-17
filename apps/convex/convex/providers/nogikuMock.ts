import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { NogikuOAuthProfile } from "./nogiku.ts";

/**
 * Nogiku のモック provider（UniQ `convex/providers/nogikuMock.ts` を踏襲）。
 * NOGIKU_MOCK_ENABLED=true のデプロイメントでだけ組み込む。provider id は本物と同じ "nogiku" なので
 * フロントは `signIn("nogiku", ...)` を切り替え無しに呼べる。
 *
 * UniQ との差分: 単一の固定ユーザーではなく `sub` / `name` / `email` を引数で受け取り、
 * 制作者・校正者・校了者・管理者など複数の委員を切り替えて動作確認できるようにした。
 */
export const MOCK_DEFAULT = {
  sub: "mock-nogiku-creator",
  name: "五月 めい",
  email: "mock-creator@example.invalid",
} as const;

export default function NogikuMock() {
  return ConvexCredentials({
    id: "nogiku",
    authorize: async (
      credentials: Record<string, unknown>,
      ctx: GenericActionCtx<GenericDataModel>,
    ) => {
      const sub =
        typeof credentials.sub === "string" && credentials.sub !== ""
          ? credentials.sub
          : MOCK_DEFAULT.sub;
      const profile: NogikuOAuthProfile = {
        id: sub,
        sub,
        name: typeof credentials.name === "string" ? credentials.name : MOCK_DEFAULT.name,
        email: typeof credentials.email === "string" ? credentials.email : `${sub}@example.invalid`,
      };
      try {
        const { user } = await retrieveAccount(ctx, { provider: "nogiku", account: { id: sub } });
        return { userId: user._id };
      } catch {
        const { user } = await createAccount(ctx, {
          provider: "nogiku",
          account: { id: sub },
          profile: profile as unknown as Record<string, never>,
        });
        return { userId: user._id };
      }
    },
  });
}
