import {
  COMMENT_THUMB_MAX_BYTES,
  hasPdfSignature,
  isCommentThumbMime,
  isGzipAllowed,
  isSourceFormatFile,
  MAX_ORIGINAL_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  needsPdfSignatureCheck,
  parseUploadEncoding,
  PDF_SIGNATURE_WINDOW,
} from "@mf100/domain";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { workersSha256Sink } from "./adapters/sha256Stream.ts";
import { importFigmaFrames, type FigmaImportItem } from "./figmaImport.ts";
import { gunzipStream, verifyGzipStream } from "./gzipStream.ts";
import { matchesIfNoneMatch, parseRange, resolveRange } from "./httpRange.ts";
import type {
  ArtifactAccess,
  BackendGateway,
  FigmaClient,
  ObjectStore,
  Sha256Sink,
  StoredObject,
  TokenVerifier,
  UploadOps,
} from "./ports.ts";
import { GatewayError } from "./ports.ts";

export interface AppDeps {
  verifier: TokenVerifier;
  gateway: BackendGateway;
  store: ObjectStore;
  allowedOrigins: string[];
  /** Figma REST API（FIGMA_ACCESS_TOKEN があるときだけ。無ければ null で /figma は「未設定」） */
  figma?: FigmaClient | null;
  /** gzip の実体を伸長しながら SHA-256 を取る口（既定は Workers の crypto.DigestStream。テストは差し替える） */
  sha256Sink?: () => Sha256Sink;
  /** Figma の書き出しの倍率（domain の FigmaPolicy.renderScale。既定 2） */
  figmaScale?: number;
}

type AppEnv = { Variables: { token: string; subject: string } };

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * MF100 HTTP 境界（§8.1）。
 * - PUT /uploads/items/:itemId   ブラウザ → R2 直接転送に相当（Worker 経由ストリーミング）。R2 側で sha256 を検証。
 *   X-MF100-Encoding: gzip のときは、本文は圧縮のまま R2 に置き、伸長しながら申告の元の大きさ・sha256 に一致することを確かめる。
 *   書込み先は試行ごとに Convex が払い出す別キー。検証の済んだ 1 つだけを Convex が原子的に採用する。
 * - GET  /files/:artifactId       認可付き配信。署名付き URL を発行しない（権限剥奪が即時に効く: A-11）。
 * - PUT / GET /comment-files/:fileId  コメント・返信の添付。同じ検証・同じヘッダー。
 *   配信は Convex の認可が返す objectKey の実体を返す（FB から移した添付は feedback/… のキーのまま同じ実体を指す）。
 *   PUT / GET /comment-files/:fileId/thumb  画像の一覧用サムネイル（webp / jpeg、512 KB まで）。
 *   サムネイルの配信だけ、機密でない制作物なら利用者ごとに 1 日 HTTP キャッシュに残してよい（originals は常に no-store）。
 * 業務ルール（版の確定・受付終了・校了）はここに置かない。
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: (origin) => (deps.allowedOrigins.includes(origin) ? origin : null),
      // Range / If-None-Match / If-Range: 配信の部分取得（PDF.js の逐次読み込み）と、手元の写しが今も有効かの確認
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "X-MF100-Sha256",
        "Range",
        "If-None-Match",
        "If-Range",
      ],
      allowMethods: ["GET", "HEAD", "PUT", "POST", "OPTIONS"],
      // ブラウザの JS から読めるようにする応答ヘッダー（範囲の取得に Content-Range・Accept-Ranges が要る）
      exposeHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "ETag"],
      maxAge: 7200,
    }),
  );

  app.get("/health", (c) => c.json({ ok: true }));

  // 認証: Bearer JWT（Convex Auth 発行）。Hono 側でも検証してから Convex に転送する。
  app.use("/uploads/*", requireAuth(deps));
  app.use("/files/*", requireAuth(deps));
  app.use("/comment-files/*", requireAuth(deps));
  app.use("/figma/*", requireAuth(deps));

  /**
   * R2 へ保存し、sha256（R2 側で検証）と申告サイズを確かめてから Convex に採用を求める。
   * 版の提出物とコメントの添付で同じ手順を使う（呼ぶ Convex 関数だけが違う）。
   * - 書込み先は試行ごとの別キー。遅れた PUT・負けた PUT が、採用済みの実体を上書きすることはない。
   * - 補償で消すのは自分の試行のキーだけ。それも「採用されていない」と確かなとき（Convex が拒否した等）に限る。
   *   採否が分からない失敗（通信断）では消さない。未採用なら期限後に清掃が消し、採用済みの実体は決して消さない。
   */
  const receiveUpload = async (
    c: Context<AppEnv>,
    id: string,
    idKey: "itemId" | "fileId",
    ops: UploadOps,
    /** 版の提出物: .ai は R2 に置いた実体の先頭を見て、PDF 互換（紙面に出せる）かを Convex に伝える */
    detectPdfCompatible = false,
  ) => {
    const token = c.get("token");
    const sha256Hex = (c.req.header("X-MF100-Sha256") ?? "").toLowerCase();
    if (!SHA256_HEX.test(sha256Hex))
      return c.json(
        { code: "sha256_required", message: "X-MF100-Sha256 ヘッダー（16進 64 文字）が必要です" },
        400,
      );
    if (!c.req.raw.body) return c.json({ code: "body_required" }, 400);
    // 符号化: 可逆圧縮（gzip）で上げた本文は、元の大きさ（X-MF100-Original-Size）と元の sha256 を申告させる。
    // 上げる本文の上限は圧縮後の大きさ（下の Content-Length）。元の大きさは 4 倍までで、伸長の途中でも申告を超えたら止める
    const encoding = parseUploadEncoding(c.req.header("X-MF100-Encoding"));
    if (encoding === null)
      return c.json({ code: "encoding_unsupported", message: "未対応の符号化です" }, 400);
    const gzip = encoding === "gzip";
    let originalSize = 0;
    if (gzip) {
      const raw = c.req.header("X-MF100-Original-Size") ?? "";
      if (!/^\d{1,15}$/.test(raw))
        return c.json(
          { code: "original_size_required", message: "X-MF100-Original-Size が必要です" },
          400,
        );
      originalSize = Number(raw);
      if (originalSize > MAX_ORIGINAL_UPLOAD_BYTES)
        return c.json(tooLarge(originalSize, MAX_ORIGINAL_UPLOAD_BYTES), 413);
    }
    // 1 ファイルの上限。platform の上限（100 MB）を超える本文はここに届く前に断られ、ブラウザには原因の分からない
    // 通信エラーになる。届いた本文は、読み始める前に理由つきで断る（申告サイズは準備のときに同じ値で断っている）
    const declaredLength = Number(c.req.header("Content-Length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES)
      return c.json(tooLarge(declaredLength), 413);

    const target = await ops.begin(token, id);
    /** 採用されていないことが確かな試行を片付ける（自分のキーを消し、破棄を記録する） */
    const discard = async (message: string) => {
      await deps.store.delete(target.objectKey).catch(() => undefined);
      await ops.fail(token, target.attemptId, message).catch(() => undefined);
    };

    if (gzip) {
      // Range で読む形（PDF・動画・音声）は圧縮して置かない（配信が範囲を返せなくなる）
      if (!isGzipAllowed({ fileName: target.fileName, mimeType: target.mimeType })) {
        await discard("この種類のファイルは圧縮して上げられません");
        return c.json({ code: "encoding_not_allowed" }, 400);
      }
      if (target.declaredSize !== null && target.declaredSize !== originalSize) {
        const message = `サイズ不一致: 申告 ${target.declaredSize} / 実体 ${originalSize}`;
        await discard(message);
        return c.json({ code: "size_mismatch", message }, 400);
      }
    }

    /** 保存した実体の大きさ（gzip は圧縮後）。Convex に伝える大きさは下の size（gzip は元の大きさ） */
    let storedSize: number;
    try {
      const meta = await deps.store.put(
        target.objectKey,
        c.req.raw.body,
        gzip
          ? { contentType: target.mimeType, encoding: "gzip", originalSize }
          : { contentType: target.mimeType, sha256Hex },
      );
      storedSize = meta.size;
    } catch (error) {
      const message = error instanceof Error ? error.message : "アップロードに失敗しました";
      await discard(message);
      return c.json({ code: "upload_failed", message }, 400);
    }
    if (storedSize > MAX_UPLOAD_BYTES) {
      await discard(`ファイルが大きすぎます: ${storedSize}`);
      return c.json(tooLarge(storedSize), 413);
    }
    let size = storedSize;
    /** gzip の実体の先頭（伸長したもの）。.ai の PDF 互換の確認に R2 を読み直さずに済む */
    let pdfCompatible: boolean | undefined;
    if (gzip) {
      // R2 に置いた実体を読み戻し、伸長しながら申告の元の大きさ・sha256 に一致することを確かめる（保存されたものそのものを証明する）
      const stored = await deps.store.get(target.objectKey).catch(() => null);
      const verdict = stored
        ? await verifyGzipStream(
            stored.body,
            { size: originalSize, sha256Hex },
            (deps.sha256Sink ?? workersSha256Sink)(),
          )
        : ({ ok: false, reason: "corrupt" } as const);
      if (!verdict.ok) {
        const message =
          verdict.reason === "size_mismatch" || verdict.reason === "too_large"
            ? `サイズ不一致: 申告 ${originalSize} / 伸長後の実体が異なります`
            : verdict.reason === "sha_mismatch"
              ? "伸長した実体の sha256 が申告と一致しません"
              : "圧縮された本文を伸長できません";
        await discard(message);
        return verdict.reason === "size_mismatch" || verdict.reason === "too_large"
          ? c.json({ code: "size_mismatch", message }, 400)
          : c.json({ code: "upload_failed", message }, 400);
      }
      // 伸長した中身が PDF なら、圧縮して置かない（紙面に出す PDF は Range で読む）
      if (!isGzipAllowed({ fileName: target.fileName, mimeType: target.mimeType }, verdict.head)) {
        await discard("この種類のファイルは圧縮して上げられません");
        return c.json({ code: "encoding_not_allowed" }, 400);
      }
      size = originalSize;
      // PDF の見出しが無いと確かめた（isGzipAllowed）ので、.ai は PDF 互換ではない
      if (detectPdfCompatible && needsPdfSignatureCheck(target.fileName)) pdfCompatible = false;
    }
    if (!gzip && target.declaredSize !== null && target.declaredSize !== size) {
      const message = `サイズ不一致: 申告 ${target.declaredSize} / 実体 ${size}`;
      await discard(message);
      return c.json({ code: "size_mismatch", message }, 400);
    }

    if (!gzip && detectPdfCompatible && needsPdfSignatureCheck(target.fileName)) {
      try {
        pdfCompatible = await readsAsPdf(deps.store, target.objectKey);
      } catch (error) {
        // 先頭を読めないときは PDF 互換とは扱わない（ダウンロード専用として保存される。誤って紙面に出さない）
        console.error("pdf signature check failed", error);
        pdfCompatible = false;
      }
    }

    let result: { status: string; failureMessage: string | null };
    try {
      result = await ops.complete(token, target.attemptId, {
        size,
        sha256: sha256Hex,
        ...(pdfCompatible !== undefined ? { pdfCompatible } : {}),
      });
    } catch (error) {
      // Convex が拒否した（mutation は巻き戻り、この試行は採用されていない）ときだけ自分の実体を消す
      if (error instanceof GatewayError) await discard(error.code);
      throw error;
    }
    // 採用されなかった（申告と違う等。Convex 側で破棄済み）なら自分の実体を消す。消し損ねても清掃が消す
    if (result.status !== "verified")
      await deps.store.delete(target.objectKey).catch(() => undefined);
    return c.json({
      [idKey]: id,
      ...result,
      size,
      sha256: sha256Hex,
      ...(gzip ? { encoding: "gzip", storedSize } : {}),
    });
  };

  /**
   * 認可済みのオブジェクトを配信する。型の推測はさせない。
   * - ブラウザの HTTP キャッシュには残さない（`private, no-store`）。権限剥奪後にキャッシュから読めないため（§9.1 / A-11）。
   *   `max-age` / `immutable` は付けない: 付けるとブラウザが Worker に尋ねずに写しを返し、剥奪が効かなくなる。
   *   手元の写し（クライアントの利用者別キャッシュ）は、毎回認可を通るここへの条件付き取得（ETag）で今も見られるか確かめる。
   * - Range 対応（206 / 416）と強い ETag（If-None-Match → 304）。認可を通ったあとにだけ判定するので、304 でも権限は毎回確かめている。
   * - 本体は R2 のストリームをそのまま渡す（Worker のメモリに溜めない）。範囲のときは R2 の範囲読み 1 回（HEAD で大きさを先に確かめない。
   *   ETag・大きさは返ってきた実体から取り、If-Range が違うときだけ全体を取り直す）。HEAD を使うのは、中身が要らない 304 の確認と、範囲が実体の外のとき（416）だけ。
   *   no-transform: 経路で圧縮・変換させない（Content-Length と範囲の位置が狂わないように）
   */
  const serve = async (access: ArtifactAccess, req: Request) => {
    const rangeHeader = req.headers.get("Range") ?? undefined;
    const ifNoneMatch = req.headers.get("If-None-Match") ?? undefined;
    const ifRange = req.headers.get("If-Range") ?? undefined;

    const headersFor = (etag: string | null, contentType: string | null) => {
      const h: Record<string, string> = {
        "Content-Type": access.mimeType || contentType || "application/octet-stream",
        "Content-Disposition": `${access.attachment ? "attachment" : dispositionFor(access.fileName)}; filename*=UTF-8''${encodeURIComponent(access.fileName)}`,
        // サムネイル（fileId ごとに内容が決まる）だけ、利用者ごとの private で 1 日残してよい。認可は最初の取得で通っている
        "Cache-Control": access.cacheable
          ? "private, max-age=86400, immutable, no-transform"
          : "private, no-store, no-transform",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      };
      if (etag) h.ETag = etag;
      return h;
    };

    /**
     * gzip で保存した実体は Worker が伸長し、元の実体をそのまま返す（Content-Encoding を付けて経路に伸長を任せない。
     * 経路や利用者の環境ごとに Content-Length・範囲の扱いが揺れるため）。圧縮した本文は範囲で読めないので範囲は無視して全体を 200 で返す。
     * ダウンロード専用の原本だけが対象で、元のファイル名で保存させる（attachment）
     */
    const decoded = (object: StoredObject) => {
      const originalSize = object.originalSize ?? access.size;
      return new Response(gunzipStream(object.body, originalSize), {
        headers: {
          ...headersFor(object.etag, object.contentType),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(access.fileName)}`,
          "Accept-Ranges": "none",
          ...(originalSize !== null ? { "Content-Length": String(originalSize) } : {}),
        },
      });
    };

    const plain = (object: StoredObject) =>
      object.encoding === "gzip"
        ? decoded(object)
        : new Response(object.body, {
            headers: {
              ...headersFor(object.etag, object.contentType),
              "Content-Length": String(object.size),
            },
          });

    // 条件（If-None-Match）が無い取得は R2 を 1 回だけ読む。大きさを知るための HEAD を先に打たない
    // （PDF.js の範囲取得は 1 ファイルで十数本。HEAD＋GET だと R2 の操作（Class B）も往復も倍になる）。
    if (!ifNoneMatch) {
      const spec = parseRange(rangeHeader);
      if (!spec) {
        // 範囲なし（または範囲として扱わない書式）: 全体を返す
        const object = await deps.store.get(access.objectKey);
        return object ? plain(object) : null;
      }
      // 範囲あり: R2 の範囲読み 1 回で 206 を作る。実体の大きさ・ETag は返ってきた実体から取る
      let ranged: StoredObject | null | "retry" = "retry";
      try {
        ranged = await deps.store.get(access.objectKey, spec);
      } catch {
        // 範囲が実体の外などで R2 が断った: 下の HEAD 経由（416 の判定）に任せる
      }
      if (ranged === null) return null;
      if (ranged !== "retry" && ranged.encoding === "gzip") {
        // 圧縮して置いた実体は範囲で返せない: 範囲読みを捨て、全体を伸長して返す
        await ranged.body.cancel().catch(() => undefined);
        const whole = await deps.store.get(access.objectKey);
        return whole ? plain(whole) : null;
      }
      if (ranged !== "retry") {
        const range = resolveRange(rangeHeader, ranged.size);
        // If-Range が今の実体の検証子と違えば、範囲は無視して全体を返す（実体は試行ごとの別キーで上書きされないので、通常は一致する）
        const stale = ifRange !== undefined && ifRange !== ranged.etag;
        if (range && range !== "unsatisfiable" && !stale)
          return new Response(ranged.body, {
            status: 206,
            headers: {
              ...headersFor(ranged.etag, ranged.contentType),
              "Content-Length": String(range.length),
              "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${ranged.size}`,
            },
          });
        await ranged.body.cancel().catch(() => undefined);
        if (stale) {
          const whole = await deps.store.get(access.objectKey);
          return whole ? plain(whole) : null;
        }
        if (range === "unsatisfiable")
          return new Response(null, {
            status: 416,
            headers: {
              ...headersFor(ranged.etag, null),
              "Content-Range": `bytes */${ranged.size}`,
            },
          });
      }
    }

    const head = await deps.store.head(access.objectKey);
    if (!head) return null;
    if (matchesIfNoneMatch(ifNoneMatch, head.etag))
      return new Response(null, { status: 304, headers: headersFor(head.etag, null) });

    if (head.encoding === "gzip") {
      const whole = await deps.store.get(access.objectKey);
      return whole ? plain(whole) : null;
    }

    // If-Range が今の実体の検証子と違えば、範囲は無視して全体を返す
    const honorRange = !ifRange || ifRange === head.etag;
    const range = honorRange ? resolveRange(rangeHeader, head.size) : null;
    if (range === "unsatisfiable")
      return new Response(null, {
        status: 416,
        headers: { ...headersFor(head.etag, null), "Content-Range": `bytes */${head.size}` },
      });
    const object = await deps.store.get(access.objectKey, range ?? undefined);
    if (!object) return null;
    if (!range)
      return new Response(object.body, {
        headers: {
          ...headersFor(object.etag, object.contentType),
          "Content-Length": String(object.size),
        },
      });
    return new Response(object.body, {
      status: 206,
      headers: {
        ...headersFor(object.etag, object.contentType),
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
      },
    });
  };

  app.put("/uploads/items/:itemId", (c) =>
    receiveUpload(c, c.req.param("itemId"), "itemId", deps.gateway.itemUploads, true),
  );

  app.get("/files/:artifactId", async (c) => {
    const access = await deps.gateway.authorizeArtifact(c.get("token"), c.req.param("artifactId"));
    return (await serve(access, c.req.raw)) ?? c.json({ code: "object_missing" }, 404);
  });

  app.put("/comment-files/:fileId", (c) =>
    receiveUpload(c, c.req.param("fileId"), "fileId", deps.gateway.commentUploads),
  );

  /**
   * サムネイル。形式（webp / jpeg）と大きさ（512 KB）をここで断り、sha256 を R2 側で検証してから Convex に記録させる。
   * 置き場は添付の名前空間の下の固定キー。小さいので本文は全部読んでから置く（読む途中でも上限を超えたら止める）
   */
  app.put("/comment-files/:fileId/thumb", async (c) => {
    const token = c.get("token");
    const fileId = c.req.param("fileId");
    const mimeType = (c.req.header("Content-Type") ?? "").toLowerCase().split(";")[0]!.trim();
    if (!isCommentThumbMime(mimeType)) return c.json({ code: "thumb_unsupported_type" }, 415);
    const sha256Hex = (c.req.header("X-MF100-Sha256") ?? "").toLowerCase();
    if (!SHA256_HEX.test(sha256Hex))
      return c.json(
        { code: "sha256_required", message: "X-MF100-Sha256 ヘッダー（16進 64 文字）が必要です" },
        400,
      );
    const stream = c.req.raw.body;
    if (!stream) return c.json({ code: "body_required" }, 400);
    const declaredLength = Number(c.req.header("Content-Length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > COMMENT_THUMB_MAX_BYTES)
      return c.json(thumbTooLarge(), 413);
    const body = await readAtMost(stream, COMMENT_THUMB_MAX_BYTES);
    if (body === null) return c.json(thumbTooLarge(), 413);
    if (body.byteLength === 0) return c.json({ code: "body_required" }, 400);

    const target = await deps.gateway.commentThumbs.begin(token, fileId);
    let size: number;
    try {
      size = (await deps.store.put(target.objectKey, body, { contentType: mimeType, sha256Hex }))
        .size;
    } catch (error) {
      const message = error instanceof Error ? error.message : "アップロードに失敗しました";
      return c.json({ code: "upload_failed", message }, 400);
    }
    const result = await deps.gateway.commentThumbs.complete(token, fileId, { size, mimeType });
    return c.json({ fileId, ...result, size });
  });

  app.get("/comment-files/:fileId", async (c) => {
    const access = await deps.gateway.authorizeCommentFile(
      c.get("token"),
      c.req.param("fileId"),
      "original",
    );
    return (await serve(access, c.req.raw)) ?? c.json({ code: "object_missing" }, 404);
  });

  app.get("/comment-files/:fileId/thumb", async (c) => {
    const access = await deps.gateway.authorizeCommentFile(
      c.get("token"),
      c.req.param("fileId"),
      "thumb",
    );
    return (await serve(access, c.req.raw)) ?? c.json({ code: "object_missing" }, 404);
  });

  /**
   * Figma 連携（docs/FIGMA_WEB_PROOFING.md FG-05。利用者決定 2026-10-17「API が使えるならまずはそっちで試す」）。
   * - GET /figma/status: トークンが設定されているか（UI が「Figma から取り込む」を出すか決める）
   * - POST /figma/import: 準備済みの項目（由来 figma）に、Figma から書き出した PNG を入れる。
   *   トークンはこの Worker の秘密で、ブラウザへは渡さない。項目の持ち主か・受付中かは Convex が確かめる
   */
  app.get("/figma/status", (c) => c.json({ enabled: Boolean(deps.figma) }));
  app.post("/figma/import", async (c) => {
    if (!deps.figma)
      return c.json(
        {
          code: "figma_not_configured",
          message:
            "Figma 連携が未設定です（FIGMA_ACCESS_TOKEN）。書き出した PNG/PDF を添付してください",
        },
        503,
      );
    const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
    const items = Array.isArray(body?.items) ? (body!.items as unknown[]) : null;
    if (!items || items.length === 0 || items.length > 50)
      return c.json({ code: "bad_request", message: "items（1〜50 件）が必要です" }, 400);
    const parsed: FigmaImportItem[] = [];
    for (const raw of items) {
      const it = raw as Record<string, unknown>;
      if (
        typeof it.itemId !== "string" ||
        typeof it.fileKey !== "string" ||
        typeof it.nodeId !== "string" ||
        it.itemId.length > 200
      )
        return c.json({ code: "bad_request", message: "items の形が違います" }, 400);
      parsed.push({ itemId: it.itemId, fileKey: it.fileKey, nodeId: it.nodeId });
    }
    const results = await importFigmaFrames(
      {
        figma: deps.figma,
        uploads: deps.gateway.itemUploads,
        store: deps.store,
        scale: deps.figmaScale ?? 2,
      },
      c.get("token"),
      parsed,
    );
    return c.json({ items: results });
  });

  app.onError((error, c) => {
    if (error instanceof GatewayError) {
      const status =
        error.code === "unauthenticated"
          ? 401
          : error.code === "upload_service_unavailable"
            ? 503
            : error.code === "bad_request"
              ? 400
              : error.code === "forbidden" || error.code.startsWith("acl_")
                ? 403
                : error.code.endsWith("not_found")
                  ? 404
                  : 409;
      return c.json({ code: error.code, details: error.details }, status);
    }
    console.error("unhandled", error);
    return c.json({ code: "internal_error" }, 500);
  });

  return app;
}

/**
 * Illustrator・InDesign の原本は紙面に出す形式ではないので、ブラウザで開かず保存させる（attachment）。
 * それ以外（PDF・画像・動画など）は従来どおり inline。拡張子で決めるので、PDF 互換で PDF として紙面に出す .ai も原本のまま保存になる
 */
function dispositionFor(fileName: string): "inline" | "attachment" {
  return isSourceFormatFile(fileName) ? "attachment" : "inline";
}

function thumbTooLarge() {
  return {
    code: "file_too_large",
    message: `サムネイルが大きすぎます。上限は ${COMMENT_THUMB_MAX_BYTES / 1024} KB です`,
    limit: COMMENT_THUMB_MAX_BYTES,
  };
}

/** 本文を最大 max バイトまで読む。超えたら読むのをやめて null（Content-Length の無い本文でも上限を守る） */
async function readAtMost(stream: ReadableStream<Uint8Array>, max: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

function tooLarge(size: number, limit = MAX_UPLOAD_BYTES) {
  return {
    code: "file_too_large",
    message: `ファイルが大きすぎます（${Math.ceil(size / 1_000_000)} MB）。上限は ${limit / 1_000_000} MB です`,
    limit,
  };
}

/** 保存した実体の先頭（PDF の見出しを探す範囲だけ）を R2 の範囲読みで取り、PDF として始まっているか */
async function readsAsPdf(store: ObjectStore, key: string): Promise<boolean> {
  const head = await store.get(key, { offset: 0, length: PDF_SIGNATURE_WINDOW });
  if (!head) return false;
  return hasPdfSignature(new Uint8Array(await new Response(head.body).arrayBuffer()));
}

function requireAuth(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "");
    if (!match) return c.json({ code: "unauthenticated" }, 401);
    const token = match[1]!;
    const verified = await deps.verifier.verify(token);
    if (!verified) return c.json({ code: "unauthenticated" }, 401);
    c.set("token", token);
    c.set("subject", verified.subject);
    await next();
  });
}
