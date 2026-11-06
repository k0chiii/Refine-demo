import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { NogikuOAuthProfile } from "./nogiku.ts";

/**
 * Nogiku のモック provider（UniQ `convex/providers/nogikuMock.ts` を踏襲）。
 * NOGIKU_MOCK_ENABLED=true のデプロイメントでだけ組み込む。provider id は本物と同じ "nogiku" なので
 * フロントは `signIn("nogiku", ...)` を切り替え無しに呼べる。
 *
 * 組織権限: モックのユーザーは `users.orgPermissions` を持たない。`NOGIKU_ACCESS_ENABLED` を true にしないデプロイメント（デモ・開発）では
 * principal が `orgPermissions = ["*"]`（works:create・approvers:assign・groups:manage など全部あり）になるので、どの委員でも登録と校了者の変更とグループの管理ができる。
 *
 * UniQ との差分: 単一の固定ユーザーではなく `sub` / `name` / `email` を引数で受け取り、
 * 制作者・校正者・校了者・管理者など複数の委員を切り替えて動作確認できるようにした。
 */
export const MOCK_DEFAULT = {
  sub: "mock-nogiku-creator",
  name: "五月 めい",
  hurigana: "さつき めい",
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
        ...(typeof credentials.hurigana === "string" && credentials.hurigana !== ""
          ? { hurigana: credentials.hurigana }
          : sub === MOCK_DEFAULT.sub
            ? { hurigana: MOCK_DEFAULT.hurigana }
            : {}),
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
