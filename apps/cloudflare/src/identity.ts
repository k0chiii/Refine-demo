/**
 * 境界で確かめた本人。
 * - Worker の JWT（src/auth）なら users.id が分かる（userId）
 * - 手元のヘッダなら subject（Nogiku の sub）だけが確か。名前・メールはヘッダにあれば持つ
 */
export type Identity =
  | { userId: string; sessionId: string }
  | { subject: string; email?: string; name?: string };

export type Identify = (request: Request) => Promise<Identity | null>;

/** 開発だけ。`X-MF100-Identity: {"subject":"u1","name":"..."}` をそのまま本人にする */
export const devIdentifier: Identify = async (request) => {
  const raw = request.headers.get("X-MF100-Identity");
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { subject, email, name } = parsed as Record<string, unknown>;
    if (typeof subject !== "string" || subject === "") return null;
    return {
      subject,
      ...(typeof email === "string" ? { email } : {}),
      ...(typeof name === "string" ? { name } : {}),
    };
  } catch {
    return null;
  }
};
