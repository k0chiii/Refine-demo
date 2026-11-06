import { registerComponents } from "./components";
import { convexTest, type TestConvex } from "convex-test";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import schema from "../convex/schema";

/**
 * convex-test ハーネス。convex/ の外に置き、Convex のバンドル対象に vitest 依存を混ぜない。
 * Convex Auth の identity.subject は `${userId}|${sessionId}` なので、users 行を作ってその形で偽装する。
 */
export const modules = import.meta.glob("../convex/**/*.*s");

// http.ts（t.fetch）は auth.ts を読み込むため、モック provider で組み立てられるよう環境を固定する
process.env.NOGIKU_MOCK_ENABLED ??= "true";
process.env.CONVEX_SITE_ORIGIN ??= "http://test.invalid";
process.env.FRONTEND_URL ??= "http://localhost:5173";

export type Harness = TestConvex<typeof schema>;

export function createHarness(): Harness {
  const t = convexTest(schema, modules);
  registerComponents(t);
  return t;
}

export interface TestUser {
  id: Id<"users">;
  as: ReturnType<Harness["withIdentity"]>;
}

export async function createUser(
  t: Harness,
  name: string,
  opts: { isSystemAdmin?: boolean } = {},
): Promise<TestUser> {
  const id = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      name,
      email: `${name}@example.invalid`,
      nogikuSubject: `sub-${name}`,
      source: "nogiku_mock",
      isSystemAdmin: opts.isSystemAdmin ?? false,
    }),
  );
  return { id, as: t.withIdentity({ subject: `${id}|session-${name}` }) };
}

export const HOUR = 3_600_000;

export async function createCast(t: Harness) {
  const [admin, manager, creator, reviewer, approver, stranger] = await Promise.all([
    createUser(t, "admin", { isSystemAdmin: true }),
    createUser(t, "manager"),
    createUser(t, "creator"),
    createUser(t, "reviewer"),
    createUser(t, "approver"),
    createUser(t, "stranger"),
  ]);
  return { admin, manager, creator, reviewer, approver, stranger };
}

/**
 * Hono が R2 で実体を検証して記録するのと同じ手順（試行の開始 → 検証完了）を、利用者の主体で internal 関数に対して行う。
 * 本番ではサービス認証付きの http.ts からだけ呼ばれる（利用者が直接呼べる公開関数は無い）。
 */
export async function uploadVerified(
  user: TestUser,
  itemId: string,
  meta: { size: number; sha256: string; pageCount?: number; pdfCompatible?: boolean },
) {
  const { attemptId } = await user.as.mutation(internal.submissions.beginUpload, { itemId });
  return user.as.mutation(internal.submissions.completeUpload, { attemptId, ...meta });
}

/** Hono が転送に失敗したときと同じ手順（試行の開始 → 失敗の記録） */
export async function uploadFailed(user: TestUser, itemId: string, message: string) {
  const { attemptId } = await user.as.mutation(internal.submissions.beginUpload, { itemId });
  await user.as.mutation(internal.submissions.failUpload, { attemptId, message });
}
