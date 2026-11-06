import { createCoalescer } from "../inflight.ts";
import type {
  ArtifactAccess,
  BackendGateway,
  ThumbOps,
  UploadAttemptTarget,
  UploadOps,
} from "../ports.ts";
import { GatewayError } from "../ports.ts";

/** 認可の問い合わせは実行中の同一のものだけまとめる（convexGateway と同じ。キーに利用者のトークンを含める） */
const coalesceAuthorize = createCoalescer();

export interface CloudflareGatewayConfig {
  requestId?: string;
  /** apps/cloudflare の URL（`POST /f/<module>:<fn>`） */
  siteUrl: string;
  /** 実体の転送の共有秘密（X-MF100-Service-Key）。未設定ならアップロードは受け付けない */
  uploadSecret: string | undefined;
}

/**
 * `POST /f/<name>` を 1 回呼んで `value` を返す（processingClient も使う）。
 * 業務が拒否した（{code}）ときだけ GatewayError。拒否は mutation が巻き戻っているので「採用されていない」と読んでよい。
 * 通信断・5xx は結果が分からないので素の Error（採否不明）。
 * service のとき、秘密の不一致・未設定（関数ごと 404 function_not_found）は何も実行されていないので upload_service_unavailable
 */
export async function callFunction<T>(
  siteUrl: string,
  name: string,
  headers: Record<string, string>,
  args: Record<string, unknown>,
  service = false,
): Promise<T> {
  const res = await fetch(`${siteUrl.replace(/\/+$/, "")}/f/${name}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (res.ok) return ((await res.json()) as { value: T }).value;
  const data = (await res.json().catch(() => null)) as {
    code?: unknown;
    details?: unknown;
  } | null;
  if (data && typeof data.code === "string") {
    if (service && data.code === "function_not_found")
      throw new GatewayError("upload_service_unavailable");
    // 引数の形の不正は Convex の http.ts の bad_request（400）にそろえる
    throw new GatewayError(
      data.code === "invalid_args" ? "bad_request" : data.code,
      data.details ?? {},
    );
  }
  if (service && res.status === 404) throw new GatewayError("upload_service_unavailable");
  throw new Error(`cloudflare backend failed: ${name} ${res.status}`);
}

/**
 * apps/cloudflare を利用者本人の JWT で呼ぶ BackendGateway（convexGateway と同じ意味）。
 * 契約: 成功は `{ value }`、業務の拒否は `{ code, details }` を 4xx。実体の転送の 3 段階だけ X-MF100-Service-Key を足す。
 */
export function createCloudflareGateway(config: CloudflareGatewayConfig): BackendGateway {
  const call = async <T>(
    name: string,
    token: string,
    args: Record<string, unknown>,
    service: boolean,
  ): Promise<T> => {
    if (service && !config.uploadSecret) throw new GatewayError("upload_service_unavailable");
    return callFunction<T>(
      config.siteUrl,
      name,
      {
        Authorization: `Bearer ${token}`,
        ...(service ? { "X-MF100-Service-Key": config.uploadSecret! } : {}),
        ...(config.requestId ? { "X-Request-ID": config.requestId } : {}),
      },
      args,
      service,
    );
  };

  const uploads = (
    fns: { begin: string; resume?: string; complete: string; fail: string },
    idKey: "itemId" | "fileId",
  ): UploadOps => ({
    async begin(token, id) {
      const target = await call<UploadAttemptTarget>(fns.begin, token, { [idKey]: id }, true);
      if (
        typeof target.attemptId !== "string" ||
        typeof target.objectKey !== "string" ||
        !target.objectKey
      )
        throw new Error("upload service returned an invalid target");
      return target;
    },
    ...(fns.resume
      ? {
          resume: (token: string, attemptId: string) =>
            call<UploadAttemptTarget & { adopted: boolean }>(
              fns.resume!,
              token,
              { attemptId },
              true,
            ),
        }
      : {}),
    complete(token, attemptId, meta) {
      return call(fns.complete, token, { attemptId, ...meta }, true);
    },
    async fail(token, attemptId, message) {
      await call(fns.fail, token, { attemptId, message }, true);
    },
  });

  const thumbs: ThumbOps = {
    async begin(token, fileId) {
      const target = await call<{ objectKey: string; fileName: string }>(
        "commentFiles:beginThumbUpload",
        token,
        { fileId },
        true,
      );
      if (typeof target.objectKey !== "string" || !target.objectKey)
        throw new Error("upload service returned an invalid target");
      return target;
    },
    complete(token, fileId, meta) {
      return call("commentFiles:completeThumbUpload", token, { fileId, ...meta }, true);
    },
  };

  return {
    itemUploads: uploads(
      {
        begin: "submissions:beginUpload",
        resume: "submissions:resumeUpload",
        complete: "submissions:completeUpload",
        fail: "submissions:failUpload",
      },
      "itemId",
    ),
    // 添付に resume は無い（Convex 版も同じ）
    commentUploads: uploads(
      {
        begin: "commentFiles:beginFileUpload",
        complete: "commentFiles:completeFileUpload",
        fail: "commentFiles:failFileUpload",
      },
      "fileId",
    ),
    commentThumbs: thumbs,
    authorizeArtifact(token, artifactId) {
      return coalesceAuthorize(`artifact\n${artifactId}\n${token}`, () =>
        call<ArtifactAccess>("artifacts:authorizeAccess", token, { artifactId }, false),
      );
    },
    authorizeCommentFile(token, fileId, variant) {
      return coalesceAuthorize(`comment\n${variant}\n${fileId}\n${token}`, () =>
        call<ArtifactAccess>("commentFiles:authorizeFile", token, { fileId, variant }, false),
      );
    },
  };
}
