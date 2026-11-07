import { createCoalescer } from "../inflight.ts";
import type { ThumbOps, UploadAttemptTarget, UploadOps } from "../ports.ts";

/**
 * convexGateway と cloudflareGateway で共通の組み立て。違うのは通信（transport）だけで、
 * 払い出された target の検査・認可の問い合わせをまとめる鍵・UploadOps の形はここに 1 つだけ置く。
 */

/**
 * 実行中の同じ認可の問い合わせをまとめる（isolate の中で共有。結果は残さない。inflight.ts）。
 * キーに利用者のトークンを含めるので、別の利用者・別のトークンの結果が混ざることはない
 */
export function createAuthorizeCoalescer() {
  const coalesce = createCoalescer();
  return {
    artifact: <T>(token: string, artifactId: string, run: () => Promise<T>) =>
      coalesce(`artifact\n${artifactId}\n${token}`, run),
    commentFile: <T>(
      token: string,
      fileId: string,
      variant: "original" | "thumb",
      run: () => Promise<T>,
    ) => coalesce(`comment\n${variant}\n${fileId}\n${token}`, run),
  };
}

function assertObjectKey(target: { objectKey?: unknown }): void {
  if (typeof target.objectKey !== "string" || !target.objectKey)
    throw new Error("upload service returned an invalid target");
}

/** 転送の 3 段階。begin が返した target の形を検査してから渡す */
export function buildUploadOps(transport: UploadOps): UploadOps {
  return {
    ...transport,
    async begin(token, id) {
      const target = await transport.begin(token, id);
      assertObjectKey(target);
      if (typeof (target as Partial<UploadAttemptTarget>).attemptId !== "string")
        throw new Error("upload service returned an invalid target");
      return target;
    },
  };
}

export function buildThumbOps(transport: ThumbOps): ThumbOps {
  return {
    ...transport,
    async begin(token, fileId) {
      const target = await transport.begin(token, fileId);
      assertObjectKey(target);
      return target;
    },
  };
}
