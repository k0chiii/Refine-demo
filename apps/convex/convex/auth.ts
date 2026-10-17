import { convexAuth } from "@convex-dev/auth/server";
import type { DatabaseWriter } from "./_generated/server";
import { resolveRedirectTo } from "./lib/redirect.ts";
import Nogiku from "./providers/nogiku.ts";
import NogikuMock from "./providers/nogikuMock.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function frontendBaseUrl(): string {
  const url = process.env.FRONTEND_URL;
  if (!url) throw new Error("FRONTEND_URL is not configured");
  return url.replace(/\/$/, "");
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** 初期ブートストラップ: 環境変数に列挙した Nogiku sub を校正システム管理者として扱う。以後は管理画面で変更できる。 */
function bootstrapAdminSubjects(): Set<string> {
  return new Set(
    (process.env.MF100_SYSTEM_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean),
  );
}

function makeNogikuProvider() {
  if (process.env.NOGIKU_MOCK_ENABLED === "true") return NogikuMock();
  return Nogiku({
    clientId: requireEnv("NOGIKU_CLIENT_ID"),
    clientSecret: requireEnv("NOGIKU_CLIENT_SECRET"),
    issuer: requireEnv("NOGIKU_ISSUER"),
  });
}

/**
 * Nogiku SSO（F-01 / C7）。UniQ の Convex Auth 構成を再利用。
 * 独自パスワードは作らない。users にはプロフィール参照と管理者フラグのみ保持する。
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [makeNogikuProvider()],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      if (args.provider.id !== "nogiku")
        throw new Error(`unsupported provider: ${args.provider.id}`);
      const subject = asString(args.profile.id) ?? asString(args.profile.sub);
      if (!subject) throw new Error("Nogiku profile has no subject");
      const isMock = process.env.NOGIKU_MOCK_ENABLED === "true";
      const now = Date.now();
      const fields = {
        nogikuSubject: subject,
        source: (isMock ? "nogiku_mock" : "nogiku") as "nogiku" | "nogiku_mock",
        lastLoginAt: now,
        ...(asString(args.profile.name) !== undefined ? { name: asString(args.profile.name) } : {}),
        ...(asString(args.profile.email) !== undefined
          ? { email: asString(args.profile.email) }
          : {}),
        ...(asString(args.profile.image) !== undefined
          ? { image: asString(args.profile.image) }
          : {}),
      };
      const bootstrapAdmin = bootstrapAdminSubjects().has(subject);

      if (args.existingUserId) {
        const existing = await ctx.db.get(args.existingUserId);
        await ctx.db.patch(args.existingUserId, {
          ...fields,
          // 既存のフラグは維持し、ブートストラップ対象なら昇格のみ行う（降格は管理画面から）
          isSystemAdmin: (existing?.isSystemAdmin ?? false) || bootstrapAdmin,
        });
        return args.existingUserId;
      }
      // 同じ sub の既存ユーザー（アカウント再連携時）を再利用する
      const bySubject = await (ctx.db as unknown as DatabaseWriter)
        .query("users")
        .withIndex("by_nogikuSubject", (q) => q.eq("nogikuSubject", subject))
        .unique();
      if (bySubject) {
        await ctx.db.patch(bySubject._id, {
          ...fields,
          isSystemAdmin: (bySubject.isSystemAdmin ?? false) || bootstrapAdmin,
        });
        return bySubject._id;
      }
      return ctx.db.insert("users", { ...fields, isSystemAdmin: bootstrapAdmin });
    },
    // 前方一致ではなく URL を解析して origin・パスの境界を厳密に比べる（lib/redirect.ts）
    redirect: async ({ redirectTo }) => resolveRedirectTo(redirectTo, frontendBaseUrl()),
  },
});
