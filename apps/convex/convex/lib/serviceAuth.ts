/**
 * サービス間エンドポイント（http.ts）の共有秘密の確認。
 * - 秘密が未設定・16 文字未満なら常に拒否（機能ごと無効）。
 * - 比較は定数時間（一致した文字数で応答時間が変わらない）。所要時間は秘密の長さだけで決まる。
 */
export const SERVICE_SECRET_MIN_LENGTH = 16;

export function verifyServiceSecret(provided: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < SERVICE_SECRET_MIN_LENGTH || provided === null) return false;
  return timingSafeEqual(provided, secret);
}

/** `Authorization: Bearer <秘密>` 形式の値から秘密を取り出す（形が違えば null） */
export function bearerValue(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1]! : null;
}

function timingSafeEqual(provided: string, secret: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!;
  return diff === 0;
}
