import {
  calculateJwkThumbprint,
  importJWK,
  jwtVerify,
  SignJWT,
  type JWK,
  type CryptoKey as JoseKey,
} from "jose";

/**
 * apps/api の joseVerifier が `audience: "convex"` を期待しているので、そのまま使う。
 * こうしておくと apps/api は JWKS の URL（と issuer）を替えるだけで済む
 */
export const AUDIENCE = "convex";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export interface JwtConfig {
  /** `AUTH_PRIVATE_KEY_JWK`。ES256（P-256）の秘密鍵を JSON にしたもの */
  privateKeyJwk: string;
  /** この Worker の origin（`SITE_URL`）。末尾のスラッシュは落とす */
  issuer: string;
  now?: () => number;
}

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export interface Jwt {
  issueAccessToken(claims: AccessClaims): Promise<string>;
  jwks(): Promise<{ keys: JWK[] }>;
  verifyAccessToken(token: string): Promise<AccessClaims | null>;
}

interface Keys {
  privateKey: JoseKey | Uint8Array;
  publicKey: JoseKey | Uint8Array;
  publicJwk: JWK;
  kid: string;
}

async function loadKeys(privateKeyJwk: string): Promise<Keys> {
  const jwk = JSON.parse(privateKeyJwk) as JWK;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d)
    throw new Error("AUTH_PRIVATE_KEY_JWK must be an ES256 (P-256) private JWK");
  // 公開鍵は秘密鍵から作る。d などを落とすだけで、鍵を 2 つ持たせない
  const { d: _d, ext: _ext, key_ops: _ops, ...pub } = jwk;
  const kid = await calculateJwkThumbprint(pub);
  const publicJwk: JWK = { ...pub, kid, alg: "ES256", use: "sig" };
  return {
    privateKey: await importJWK(jwk, "ES256"),
    publicKey: await importJWK(publicJwk, "ES256"),
    publicJwk,
    kid,
  };
}

/**
 * Convex Auth の代わりに自分で JWT（ES256）を出し、同じ鍵で検証もする。
 * 鍵の読み込みは 1 度だけ（最初に使うときまで待つので、鍵の無い環境でも作るだけなら落ちない）。
 * ponytail: 鍵は 1 本だけ。回転するときは JWKS に新旧 2 本を載せて、発行を新しい方へ切り替える
 */
export function createJwt(config: JwtConfig): Jwt {
  const now = config.now ?? Date.now;
  const issuer = config.issuer.replace(/\/+$/, "");
  let keys: Promise<Keys> | undefined;
  const load = () => (keys ??= loadKeys(config.privateKeyJwk));

  return {
    async issueAccessToken({ userId, sessionId }) {
      const { privateKey, kid } = await load();
      const iat = Math.floor(now() / 1000);
      // sub は「利用者 ID|セッション ID」。web の lib/jwt.ts が `|` で割って利用者 ID を取る
      return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
        .setSubject(`${userId}|${sessionId}`)
        .setIssuer(issuer)
        .setAudience(AUDIENCE)
        .setIssuedAt(iat)
        .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
        .sign(privateKey);
    },

    async jwks() {
      return { keys: [(await load()).publicJwk] };
    },

    async verifyAccessToken(token) {
      try {
        const { publicKey } = await load();
        const { payload } = await jwtVerify(token, publicKey, {
          issuer,
          audience: AUDIENCE,
          algorithms: ["ES256"],
          currentDate: new Date(now()),
        });
        if (typeof payload.sub !== "string") return null;
        const [userId, sessionId, ...rest] = payload.sub.split("|");
        if (!userId || !sessionId || rest.length > 0) return null;
        return { userId, sessionId };
      } catch {
        return null;
      }
    },
  };
}
