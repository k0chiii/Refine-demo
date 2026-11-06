import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** 境界で確かめた本人。誰か（subject）だけが確か。名前・メールは Access の claim にあれば持つ */
export interface Identity {
  subject: string;
  email?: string;
  name?: string;
}

export type Identify = (request: Request) => Promise<Identity | null>;

/**
 * Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）から本人を読む。
 * Convex Auth（Nogiku OIDC）の代わりは Cloudflare の中で完結する Access。Nogiku の profile（ふりがな・組織権限）は
 * Access の IdP 連携か、サインイン後の同期で埋める（未実装。docs/CLOUDFLARE_BACKEND.md）
 */
export function accessIdentifier(team: string, audience: string, keys?: JWTVerifyGetKey): Identify {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(team) || !audience)
    throw new Error("Invalid Cloudflare Access configuration");
  const issuer = `https://${team}.cloudflareaccess.com`;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (request) => {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
        algorithms: ["RS256", "ES256"],
      });
      if (typeof payload.sub !== "string") return null;
      return {
        subject: payload.sub,
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
      };
    } catch {
      return null;
    }
  };
}

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
