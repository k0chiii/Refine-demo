import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { createCoalescer } from "../inflight.ts";
import type { BackendGateway, ThumbOps, UploadAttemptTarget, UploadOps } from "../ports.ts";
import { GatewayError } from "../ports.ts";

/**
 * 実行中の同じ認可の問い合わせをまとめる（isolate の中で共有。結果は残さない。inflight.ts）。
 * キーに利用者のトークンを含めるので、別の利用者・別のトークンの結果が混ざることはない
 */
const coalesceAuthorize = createCoalescer();

export interface ConvexGatewayConfig {
  /** Convex deployment URL（公開 query の呼出し） */
  convexUrl: string;
  /** Convex の HTTP actions の URL（サービス認証付きの /internal エンドポイント） */
  siteUrl: string;
  /** 実体の転送をサービスとして記録するための共有秘密。未設定ならアップロードは受け付けない */
  uploadSecret: string | undefined;
}

/**
 * Convex を利用者本人のトークンで呼ぶ。配信の認可（公開 query）は利用者として尋ねるだけ。
 * 実体の転送（試行の開始・採用・破棄）は、利用者の JWT に加えてサービスの秘密を付けて http.ts の
 * internal エンドポイントを呼ぶ（利用者が直接「検証済み」を申告できる公開関数は無い）。
 */
export function createConvexGateway(config: ConvexGatewayConfig): BackendGateway {
  const withAuth = (token: string) => {
    const client = new ConvexHttpClient(config.convexUrl);
    client.setAuth(token);
    return client;
  };
  const translate = (error: unknown): never => {
    if (error instanceof ConvexError) {
      const data = error.data as { code?: string; details?: unknown };
      throw new GatewayError(data.code ?? "convex_error", data.details ?? {});
    }
    throw error;
  };
  const base = config.siteUrl.replace(/\/$/, "");

  /**
   * サービス境界の呼出し。Convex が業務として拒否した（{code} を返した）ときだけ GatewayError にする。
   * その場合 mutation は巻き戻っているので、呼出し側は「採用されていない」と判断してよい。
   * 通信断・5xx など結果の分からない失敗は素の Error（採否不明として扱わせる）。
   */
  const call = async <T>(token: string, path: string, body: Record<string, unknown>) => {
    if (!config.uploadSecret) throw new GatewayError("upload_service_unavailable");
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-MF100-Service-Key": config.uploadSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;
    const data = (await res.json().catch(() => null)) as {
      code?: unknown;
      details?: unknown;
    } | null;
    if (data && typeof data.code === "string")
      throw new GatewayError(data.code, data.details ?? {});
    // 秘密の不一致・未設定（Convex は機能ごと 404）: 何も実行されていない
    if (res.status === 404) throw new GatewayError("upload_service_unavailable");
    throw new Error(`upload service failed: ${res.status}`);
  };

  const uploads = (prefix: string, idKey: "itemId" | "fileId"): UploadOps => ({
    async begin(token, id) {
      const target = await call<UploadAttemptTarget>(token, `${prefix}/begin`, { [idKey]: id });
      if (
        typeof target.attemptId !== "string" ||
        typeof target.objectKey !== "string" ||
        !target.objectKey
      )
        throw new Error("upload service returned an invalid target");
      return target;
    },
    async complete(token, attemptId, meta) {
      return call(token, `${prefix}/complete`, { attemptId, ...meta });
    },
    async fail(token, attemptId, message) {
      await call(token, `${prefix}/fail`, { attemptId, message });
    },
  });

  const thumbs: ThumbOps = {
    async begin(token, fileId) {
      const target = await call<{ objectKey: string; fileName: string }>(
        token,
        "/internal/comments/thumbs/begin",
        { fileId },
      );
      if (typeof target.objectKey !== "string" || !target.objectKey)
        throw new Error("upload service returned an invalid target");
      return target;
    },
    async complete(token, fileId, meta) {
      return call(token, "/internal/comments/thumbs/complete", { fileId, ...meta });
    },
  };

  return {
    itemUploads: uploads("/internal/uploads/items", "itemId"),
    authorizeArtifact(token, artifactId) {
      return coalesceAuthorize(`artifact\n${artifactId}\n${token}`, () =>
        withAuth(token)
          .query(api.artifacts.authorizeAccess, { artifactId: artifactId as Id<"artifacts"> })
          .catch(translate),
      );
    },
    commentUploads: uploads("/internal/comments/files", "fileId"),
    commentThumbs: thumbs,
    authorizeCommentFile(token, fileId, variant) {
      return coalesceAuthorize(`comment\n${variant}\n${fileId}\n${token}`, () =>
        withAuth(token).query(api.commentFiles.authorizeFile, { fileId, variant }).catch(translate),
      );
    },
  };
}
