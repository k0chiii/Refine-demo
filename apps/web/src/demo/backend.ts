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

  /** internal 関数も呼べる（Hono のサービス境界の代わり。デモでは Worker が無いため） */
  async mutation<M extends FunctionReference<"mutation", "public" | "internal">>(
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

  /**
   * Hono PUT /uploads/items/:itemId 相当: 本番の Hono と同じ手順をサービス境界の internal 関数で踏む
   * （試行の開始 → この試行のキーに Blob を保持 → 検証完了で採用）。
   */
  async uploadItem(
    itemId: string,
    file: File,
    sha256: string,
    /** Figma から取り込んだとき（Worker の /figma/import 相当）に添える値 */
    figma?: {
      nodeName: string;
      figmaVersion?: string;
      lastModified?: string;
      box: { width: number; height: number };
    },
  ): Promise<{ status: string; failureMessage: string | null }> {
    const target = (await this.mutation(internal.submissions.beginUpload, { itemId })) as {
      attemptId: string;
      objectKey: string;
    };
    this.blobs.set(target.objectKey, file);
    try {
      return (await this.mutation(internal.submissions.completeUpload, {
        attemptId: target.attemptId,
        size: file.size,
        sha256,
        ...(figma ? { figma } : {}),
      })) as { status: string; failureMessage: string | null };
    } catch (error) {
      // 採用されなかった試行の実体は自分で消す（本番の Hono の補償と同じ）
      this.blobs.delete(target.objectKey);
      await this.mutation(internal.submissions.failUpload, {
        attemptId: target.attemptId,
        message: error instanceof Error ? error.message : "upload failed",
      }).catch(() => undefined);
      throw error;
    }
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

  /** Hono PUT /feedback/files/:id 相当: 版の提出と同じく、試行の開始 → 保持 → 検証完了で採用 */
  async uploadFeedbackFile(
    fileId: string,
    file: File,
    sha256: string,
  ): Promise<{ status: string; failureMessage: string | null }> {
    const target = (await this.mutation(internal.feedback.beginFileUpload, { fileId })) as {
      attemptId: string;
      objectKey: string;
    };
    this.blobs.set(target.objectKey, file);
    try {
      return (await this.mutation(internal.feedback.completeFileUpload, {
        attemptId: target.attemptId,
        size: file.size,
        sha256,
      })) as { status: string; failureMessage: string | null };
    } catch (error) {
      this.blobs.delete(target.objectKey);
      await this.mutation(internal.feedback.failFileUpload, {
        attemptId: target.attemptId,
        message: error instanceof Error ? error.message : "upload failed",
      }).catch(() => undefined);
      throw error;
    }
  }

  /** Hono GET /feedback/files/:id 相当: 認可は Convex の authorizeFile */
  async fetchFeedbackFile(fileId: string): Promise<Blob> {
    const access = (await this.query(api.feedback.authorizeFile, { fileId })) as {
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
