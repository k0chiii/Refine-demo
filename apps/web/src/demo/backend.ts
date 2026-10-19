/**
 * デモモード（バックエンド無し）: apps/convex の **実際の関数コード**を convex-test でブラウザ内実行する。
 * - 認証は Nogiku モック相当（sub を選んでサインイン）。
 * - ファイルは R2 の代わりにメモリ上の Blob。
 * - 用途: UI 開発、スクリーンショット、E2E。業務ロジックは本番と同じ domain/application/convex のコードが動く。
 */
import {
  hasPdfSignature,
  isGzipAllowed,
  MAX_ORIGINAL_UPLOAD_BYTES,
  needsPdfSignatureCheck,
  PDF_SIGNATURE_WINDOW,
} from "@mf100/domain";
import type { FunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../../../convex/convex/schema";
import { api, internal } from "../../../convex/convex/_generated/api";
import { gunzipBlob, sha256Hex } from "@/lib/uploadEncoding";

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

/**
 * convex-test は globalThis の Math・Date・performance・setTimeout など（下の一覧）を、構築時と関数呼び出しのたびに
 * アクセサ（読むたびに AsyncLocalStorage を見る）へ差し替える（トランザクション中の fetch・setTimeout を禁じるため）。
 * アクセサはアプリ全体に効くので、M3E の配色計算（Math.* を数十万回）・PDF.js の描画・React まで遅くなっていた
 * （4 倍遅い CPU で初回読み込みの長いタスクが +300ms。docs/UI_M3E.md §60）。
 * デモでは Convex 呼び出しを 1 本のキューで直列化しているので、構築直後と各呼び出しの後に元のプロパティへ戻す
 * （呼び出しの最中だけアクセサになる）。本番ビルドにはこのファイルは入らない。
 */
const PATCHED_GLOBALS = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "fetch",
  "Date",
  "Math",
  "console",
  "process",
  "crypto",
  "Crypto",
  "CryptoKey",
  "SubtleCrypto",
  "atob",
  "btoa",
  "Request",
  "Response",
  "Headers",
  "URL",
  "URLSearchParams",
  "AbortController",
  "TextEncoder",
  "TextDecoder",
  "structuredClone",
  "queueMicrotask",
  "performance",
] as const;
/** convex-test を構築する前の、globalThis 自身のプロパティ（継承しているものは undefined） */
const originalGlobals = new Map(
  PATCHED_GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const),
);
function restoreGlobals(): void {
  for (const [key, original] of originalGlobals) {
    const now = Object.getOwnPropertyDescriptor(globalThis, key);
    if (!now?.get || !now.configurable) continue; // 差し替えられていない
    if (original) Object.defineProperty(globalThis, key, original);
    else delete (globalThis as unknown as Record<string, unknown>)[key]; // 継承したものに戻る
  }
}

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
  /** gzip で上げた実体（キー → 元の MIME）。blobs には圧縮のまま置き、配信で伸長して元の実体を返す（本番の Worker と同じ） */
  private readonly gzipTypes = new Map<string, string>();
  private seeded: Promise<void> | null = null;

  constructor() {
    // convexTest() が差し替えた globalThis のプロパティを戻す（上の restoreGlobals）
    restoreGlobals();
  }

  /** 全ての Convex 呼び出しを直列化する（AsyncLocalStorage シムの前提）。 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    // 呼び出しが終わるたびに、convex-test が差し替えた globalThis のプロパティを元に戻す（上の restoreGlobals）
    const run = async () => {
      try {
        return await fn();
      } finally {
        restoreGlobals();
      }
    };
    const next = this.queue.then(run, run);
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
    /** gzip で上げるとき（本番の X-MF100-Encoding: gzip）。file は元のファイル（名前・種類）、body が圧縮後の本文 */
    gzip?: { body: Blob; originalSize: number },
  ): Promise<{ status: string; failureMessage: string | null }> {
    const target = (await this.mutation(internal.submissions.beginUpload, { itemId })) as {
      attemptId: string;
      objectKey: string;
    };
    this.blobs.set(target.objectKey, gzip ? gzip.body : file);
    if (gzip) this.gzipTypes.set(target.objectKey, file.type);
    try {
      // 本番の Worker と同じ検証: 伸長して、申告した元の大きさ・sha256 と一致する実体であることを確かめる
      if (gzip) await this.verifyGzip(file, gzip, sha256);
      return (await this.mutation(internal.submissions.completeUpload, {
        attemptId: target.attemptId,
        size: gzip ? gzip.originalSize : file.size,
        sha256,
        // 本番の Worker と同じく、.ai だけ実体の先頭を見て PDF 互換かを伝える（gzip で上げた .ai は PDF の見出しが無いと確かめ済み）
        ...(needsPdfSignatureCheck(file.name)
          ? {
              pdfCompatible: gzip
                ? false
                : hasPdfSignature(
                    new Uint8Array(await file.slice(0, PDF_SIGNATURE_WINDOW).arrayBuffer()),
                  ),
            }
          : {}),
        ...(figma ? { figma } : {}),
      })) as { status: string; failureMessage: string | null };
    } catch (error) {
      // 採用されなかった試行の実体は自分で消す（本番の Hono の補償と同じ）
      this.discard(target.objectKey);
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
    return this.read(access.objectKey);
  }

  /** 保持している実体を元の実体として返す（gzip で上げたものは伸長する。本番の Worker の配信と同じ） */
  private async read(key: string): Promise<Blob> {
    const blob = this.blobs.get(key);
    if (!blob) throw new Error("object missing");
    const type = this.gzipTypes.get(key);
    return type === undefined ? blob : gunzipBlob(blob, type);
  }

  private discard(key: string) {
    this.blobs.delete(key);
    this.gzipTypes.delete(key);
  }

  /**
   * 本番の Worker の verifyGzipStream 相当: 伸長して、申告した元の大きさ・sha256 に一致するか、
   * Range で読む形（PDF・動画）や PDF の見出しを持つ中身ではないかを確かめる。違えば例外（採用されない）
   */
  private async verifyGzip(
    file: File,
    gzip: { body: Blob; originalSize: number },
    sha256: string,
  ): Promise<void> {
    if (gzip.originalSize > MAX_ORIGINAL_UPLOAD_BYTES) throw new Error("ファイルが大きすぎます");
    let original: Blob;
    try {
      original = await gunzipBlob(gzip.body, file.type, gzip.originalSize);
    } catch {
      throw new Error("圧縮された本文を伸長できません");
    }
    if (original.size !== gzip.originalSize)
      throw new Error(`サイズ不一致: 申告 ${gzip.originalSize} / 実体 ${original.size}`);
    if ((await sha256Hex(await original.arrayBuffer())) !== sha256)
      throw new Error("伸長した実体の sha256 が申告と一致しません");
    const head = new Uint8Array(await original.slice(0, PDF_SIGNATURE_WINDOW).arrayBuffer());
    if (!isGzipAllowed({ fileName: file.name, mimeType: file.type }, head))
      throw new Error("この種類のファイルは圧縮して上げられません");
  }

  /** Hono PUT /feedback/files/:id 相当: 版の提出と同じく、試行の開始 → 保持 → 検証完了で採用 */
  async uploadFeedbackFile(
    fileId: string,
    file: File,
    sha256: string,
    /** gzip で上げるとき（uploadItem と同じ） */
    gzip?: { body: Blob; originalSize: number },
  ): Promise<{ status: string; failureMessage: string | null }> {
    const target = (await this.mutation(internal.feedback.beginFileUpload, { fileId })) as {
      attemptId: string;
      objectKey: string;
    };
    this.blobs.set(target.objectKey, gzip ? gzip.body : file);
    if (gzip) this.gzipTypes.set(target.objectKey, file.type);
    try {
      if (gzip) await this.verifyGzip(file, gzip, sha256);
      return (await this.mutation(internal.feedback.completeFileUpload, {
        attemptId: target.attemptId,
        size: gzip ? gzip.originalSize : file.size,
        sha256,
      })) as { status: string; failureMessage: string | null };
    } catch (error) {
      this.discard(target.objectKey);
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
    return this.read(access.objectKey);
  }
}

export const demo = new DemoBackend();

// E2E / スクリーンショット用に window から操作できるようにする
(globalThis as unknown as { __mf100demo?: DemoBackend; __mf100api?: unknown }).__mf100demo = demo;
(globalThis as unknown as { __mf100api?: unknown }).__mf100api = api;
