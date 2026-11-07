import type { ServiceSecret } from "./functions/define.ts";

/**
 * サービス間の共有秘密の確認。apps/convex/convex/lib/serviceAuth.ts と同じ約束:
 * - 秘密が未設定・短すぎるなら常に拒否（その関数ごと無効 = 404）
 * - 比較は定数時間（一致した文字数で応答時間が変わらない）
 */
export const SERVICE_SECRET_MIN_LENGTH = 16;

/** Convex の http.ts は処理ジョブの秘密だけ 32 文字以上を求める */
const MIN_LENGTH: Partial<Record<ServiceSecret, number>> = { PROCESSING_SECRET: 32 };

/** 秘密の渡し方も http.ts と同じ: アップロードは X-MF100-Service-Key、ほかは Authorization: Bearer */
export function providedSecret(request: Request, name: ServiceSecret): string | null {
  if (name === "MF100_UPLOAD_SECRET") return request.headers.get("X-MF100-Service-Key");
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") ?? "");
  return match ? match[1]! : null;
}

export function verifyServiceSecret(
  request: Request,
  name: ServiceSecret,
  secret: string | undefined,
): boolean {
  const provided = providedSecret(request, name);
  if (!secret || secret.length < (MIN_LENGTH[name] ?? SERVICE_SECRET_MIN_LENGTH)) return false;
  if (provided === null) return false;
  return timingSafeEqual(provided, secret);
}

function timingSafeEqual(provided: string, secret: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}
