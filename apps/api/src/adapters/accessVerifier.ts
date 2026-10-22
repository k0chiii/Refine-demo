import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Optional staging/administration gate. Application JWTs and work ACLs are still required afterwards. */
export function createAccessVerifier(team: string, audience: string, keys?: JWTVerifyGetKey) {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(team) || !audience)
    throw new Error("Invalid Cloudflare Access configuration");
  const issuer = `https://${team}.cloudflareaccess.com`;
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  return async (request: Request): Promise<boolean> => {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return false;
    try {
      await jwtVerify(token, jwks, { issuer, audience, algorithms: ["RS256", "ES256"] });
      return true;
    } catch {
      return false;
    }
  };
}
