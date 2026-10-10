/**
 * デモモード（バックエンド無し）: apps/convex の **実際の関数コード**を convex-test でブラウザ内実行する。
 * - 認証は Nogiku モック相当（sub を選んでサインイン）。
 * - ファイルは R2 の代わりにメモリ上の Blob。
 * - 用途: UI 開発、スクリーンショット、E2E。業務ロジックは本番と同じ domain/application/convex のコードが動く。
 */
import type { FunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../../../convex/convex/schema";
import { api, internal } from "../../../convex/convex/_generated/api";

type Env = Record<string, string | undefined>;
const g = globalThis as unknown as { process?: { env: Env } };
g.process ??= { env: {} };
Object.assign(g.process.env, {
  NOGIKU_MOCK_ENABLED: "true",
  MF100_SYSTEM_ADMIN_SUBJECTS: "mock-nogiku-admin",
  CONVEX_SITE_ORIGIN: "http://demo.invalid",
  FRONTEND_URL: location.origin,
});

const modules = import.meta.glob("../../../convex/convex/**/*.*s");

export interface DemoUser {
  id: string;
  sub: string;
  name: string;
  email: string;
}

class DemoBackend {
  readonly t: TestConvex<typeof schema> = convexTest(schema, modules);
  private queue: Promise<unknown> = Promise.resolve();
  private currentUserId: string | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly blobs = new Map<string, Blob>();
  private seeded: Promise<void> | null = null;

  /** 全ての Convex 呼び出しを直列化する（AsyncLocalStorage シムの前提）。 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private bump() {
    this.version++;
    for (const l of this.listeners) l();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  getVersion(): number {
    return this.version;
  }

  get userId(): string | null {
    return this.currentUserId;
  }

  private identity() {
    return this.currentUserId
      ? this.t.withIdentity({ subject: `${this.currentUserId}|demo-session` })
      : this.t;
  }

  ensureSeeded(): Promise<void> {
    this.seeded ??= this.enqueue(async () => {
      await this.t.mutation(internal.seed.demo, {});
    });
    return this.seeded;
  }

  async users(): Promise<DemoUser[]> {
    await this.ensureSeeded();
    return this.enqueue(() =>
      this.t.run(async (ctx) => {
        const rows = await ctx.db.query("users").collect();
        return rows
          .filter((u) => u.nogikuSubject)
          .map((u) => ({
            id: u._id as string,
            sub: u.nogikuSubject!,
            name: u.name ?? "",
            email: u.email ?? "",
          }));
      }),
    );
  }

  /** Nogiku モックと同じ: sub でユーザーを特定し、無ければ作る。 */
  async signIn(sub: string, name?: string): Promise<void> {
    await this.ensureSeeded();
    const id = await this.enqueue(() =>
      this.t.run(async (ctx) => {
        const existing = await ctx.db
          .query("users")
          .withIndex("by_nogikuSubject", (q) => q.eq("nogikuSubject", sub))
          .unique();
        if (existing) {
          await ctx.db.patch(existing._id, { lastLoginAt: Date.now() });
          return existing._id as string;
        }
        return (await ctx.db.insert("users", {
          nogikuSubject: sub,
          name: name ?? sub,
          email: `${sub}@example.invalid`,
          source: "nogiku_mock",
          isSystemAdmin: sub === "mock-nogiku-admin",
          lastLoginAt: Date.now(),
        })) as string;
      }),
    );
    this.currentUserId = id;
    this.bump();
  }

  signOut(): void {
    this.currentUserId = null;
    this.bump();
  }

  query<Q extends FunctionReference<"query">>(
    ref: Q,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    return this.enqueue(() =>
      (this.identity() as unknown as { query: (r: Q, a: unknown) => Promise<unknown> }).query(
        ref,
        args,
      ),
    );
  }

  async mutation<M extends FunctionReference<"mutation">>(
    ref: M,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.enqueue(() =>
        (
          this.identity() as unknown as { mutation: (r: M, a: unknown) => Promise<unknown> }
        ).mutation(ref, args),
      );
    } finally {
      this.bump();
    }
  }

  /** Hono PUT /uploads/items/:id 相当: Blob を保持し、実体検証済みとして Convex に記録する。 */
  async uploadItem(
    itemId: string,
    file: File,
    sha256: string,
  ): Promise<{ status: string; failureMessage: string | null }> {
    const objectKey = await this.enqueue(() =>
      this.t.run(async (ctx) => {
        const item = await ctx.db.get("uploadItems", itemId as never);
        return item?.objectKey ?? null;
      }),
    );
    if (!objectKey) throw new Error("upload item not found");
    this.blobs.set(objectKey, file);
    return (await this.mutation(api.submissions.markVerified, {
      itemId,
      size: file.size,
      sha256,
    })) as { status: string; failureMessage: string | null };
  }

  /** Hono GET /files/:artifactId 相当: 認可は Convex の authorizeAccess をそのまま使う。 */
  async fetchArtifact(artifactId: string): Promise<Blob> {
    const access = (await this.query(api.artifacts.authorizeAccess, { artifactId })) as {
      objectKey: string;
    };
    const blob = this.blobs.get(access.objectKey);
    if (!blob) throw new Error("object missing");
    return blob;
  }
}

export const demo = new DemoBackend();

// E2E / スクリーンショット用に window から操作できるようにする
(globalThis as unknown as { __mf100demo?: DemoBackend; __mf100api?: unknown }).__mf100demo = demo;
(globalThis as unknown as { __mf100api?: unknown }).__mf100api = api;
