import { Hono } from "hono";
import { readNogikuAccessConfig, resolveRedirectTo } from "@mf100/platform";
import type { AuthEnv } from "./env.ts";
import { createJwt, type Jwt } from "./jwt.ts";
import { createOidc } from "./oidc.ts";
import { sha256Base64url, type AuthProfile, type AuthStore, type SessionGrant } from "./store.ts";

export interface AuthDeps {
  /** Durable Object 越しの口。テストは SQLite を直に包んだものを渡す */
  store(): AuthStore;
  env: AuthEnv;
  fetch?: typeof fetch;
  now?: () => number;
}

/** providers/nogikuMock.ts と同じ既定値 */
const MOCK_DEFAULT = {
  sub: "mock-nogiku-creator",
  name: "五月 めい",
  hurigana: "さつき めい",
} as const;

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Convex Auth（Nogiku OIDC）の代わり。Worker が自分で OIDC を回し、自分の JWT（ES256）と JWKS を出す。
 * 組み込みは `app.route("/", authApp(deps))`。経路はすべて絶対パスで、/.well-known/jwks.json もここが持つ。
 *
 * ログインの流れは Convex Auth と同じ: callback は URL にトークンを載せず、60 秒・1 回きりの一時コードだけを
 * Web へ返し、Web が POST /auth/token で access / refresh に替える。
 * 一時コードは PKCE と同じ形で、サインインを始めたブラウザに結び付ける。Web が乱数の verifier を作り、
 * その SHA-256（challenge）を /auth/signin か /auth/mock に渡す。/auth/token は verifier が合うときだけ通す
 * （戻りの URL を横取りされても、verifier はそのブラウザの sessionStorage にしか無いので替えられない）。
 */
export function authApp(deps: AuthDeps) {
  const { env } = deps;
  const now = deps.now ?? Date.now;
  const fetchImpl: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const mock = env.NOGIKU_MOCK_ENABLED === "true";
  const issuer = env.SITE_URL?.replace(/\/+$/, "");

  const notConfigured = (missing: string[]) =>
    ({ code: "auth_not_configured", details: { missing } }) as const;
  const missingOf = (names: (keyof AuthEnv)[]) => names.filter((n) => !env[n]);

  // 鍵は最初に使うまで読まない（無くても /auth/signin などの 404・400 は返せる）
  let signer: Jwt | undefined;
  const jwt = () =>
    (signer ??= createJwt({
      privateKeyJwk: env.AUTH_PRIVATE_KEY_JWK ?? "",
      issuer: issuer ?? "",
      now,
    }));
  const base = ["AUTH_PRIVATE_KEY_JWK", "SITE_URL"] as const;
  const browser = [
    ...base,
    "FRONTEND_URL",
    "NOGIKU_CLIENT_ID",
    "NOGIKU_CLIENT_SECRET",
    "NOGIKU_ISSUER",
  ] as const;

  const adminSubjects = new Set(
    (env.MF100_SYSTEM_ADMIN_SUBJECTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  /** callback とモックで共通: プロフィール → 利用者 → セッション → 一時コード */
  const signedIn = async (
    profile: AuthProfile,
    source: "nogiku" | "nogiku_mock",
    challenge: string,
  ) => {
    const store = deps.store();
    const userId = await store.upsertUserFromProfile(profile, {
      source,
      admin: adminSubjects.has(profile.sub),
    });
    const { sessionId } = await store.createSession(userId);
    return store.issueCode(sessionId, challenge);
  };

  const tokens = async (grant: SessionGrant) => ({
    accessToken: await jwt().issueAccessToken(grant),
    refreshToken: grant.refreshToken,
  });

  // base64url(SHA-256) は 43 文字。形が違うものは verifier から作られたものではない
  const challengeOf = (v: unknown) =>
    typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;

  const readBody = async (req: Request): Promise<Record<string, unknown>> => {
    const body: unknown = await req.json().catch(() => null);
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  };

  const app = new Hono()
    // トークンや一時コードを返す経路は、どこにも写しを残させない
    .use("/auth/*", async (c, next) => {
      await next();
      c.header("Cache-Control", "no-store");
    })

    .get("/auth/signin", async (c) => {
      if (mock) return c.json({ code: "mock_enabled", details: {} }, 404);
      if ((c.req.query("provider") ?? "nogiku") !== "nogiku")
        return c.json({ code: "unsupported_provider", details: {} }, 400);
      const oidc = oidcOf(env, fetchImpl, now);
      const missing = missingOf([...browser]);
      if (!oidc || missing.length > 0) return c.json(notConfigured(missing), 500);

      let redirectTo: string;
      try {
        redirectTo = resolveRedirectTo(c.req.query("redirectTo") ?? "/", env.FRONTEND_URL ?? "");
      } catch {
        return c.json({ code: "invalid_redirect", details: {} }, 400);
      }
      const challenge = challengeOf(c.req.query("challenge"));
      if (!challenge) return c.json({ code: "challenge_required", details: {} }, 400);
      let auth;
      try {
        auth = await oidc.authorize();
      } catch (e) {
        console.warn("OIDC discovery failed", e);
        return c.json({ code: "oidc_unavailable", details: {} }, 502);
      }
      const store = deps.store();
      // 掃除はログインの入口に相乗りさせる（専用の定期実行を要らなくする）
      await store.sweep();
      await store.putState({
        state: auth.state,
        verifier: auth.verifier,
        nonce: auth.nonce,
        redirectTo,
        challenge,
      });
      return c.redirect(auth.url, 302);
    })

    .get("/auth/callback", async (c) => {
      if (mock) return c.json({ code: "mock_enabled", details: {} }, 404);
      const oidc = oidcOf(env, fetchImpl, now);
      const missing = missingOf([...browser]);
      if (!oidc || missing.length > 0) return c.json(notConfigured(missing), 500);
      const code = c.req.query("code");
      const state = c.req.query("state");
      if (!code || !state) return c.json({ code: "invalid_request", details: {} }, 400);
      // state は 1 回きり。ここで消すので、同じ callback を再送しても通らない
      const saved = await deps.store().takeState(state);
      if (!saved) return c.json({ code: "invalid_state", details: {} }, 400);
      let profile: AuthProfile;
      try {
        profile = await oidc.exchange({ code, verifier: saved.verifier, nonce: saved.nonce });
      } catch (e) {
        console.warn("OIDC exchange failed", e);
        return c.json({ code: "oidc_failed", details: {} }, 502);
      }
      const oneTime = await signedIn(profile, "nogiku", saved.challenge);
      const to = new URL(saved.redirectTo);
      to.searchParams.set("code", oneTime);
      return c.redirect(to.href, 302);
    })

    .post("/auth/token", async (c) => {
      const missing = missingOf([...base]);
      if (missing.length > 0) return c.json(notConfigured(missing), 500);
      const body = await readBody(c.req.raw);
      const code = str(body.code);
      const verifier = str(body.verifier);
      // コードは先に消える。verifier が違っても、当てずっぽうを繰り返せない
      const consumed = code ? await deps.store().consumeCode(code) : null;
      const bound =
        consumed && verifier && (await sha256Base64url(verifier)) === consumed.challenge;
      const grant = bound ? await deps.store().reissueRefresh(consumed.sessionId) : null;
      if (!grant) return c.json({ code: "invalid_code", details: {} }, 401);
      return c.json(await tokens(grant));
    })

    .post("/auth/refresh", async (c) => {
      const missing = missingOf([...base]);
      if (missing.length > 0) return c.json(notConfigured(missing), 500);
      const refreshToken = str((await readBody(c.req.raw)).refreshToken);
      const grant = refreshToken ? await deps.store().rotateSession(refreshToken) : null;
      if (!grant) return c.json({ code: "invalid_refresh_token", details: {} }, 401);
      return c.json(await tokens(grant));
    })

    .post("/auth/signout", async (c) => {
      const refreshToken = str((await readBody(c.req.raw)).refreshToken);
      // 知らない refresh でも成功にする（サインアウトは何度呼ばれても同じ結果にしたい）
      if (refreshToken) await deps.store().revokeSession(refreshToken);
      return c.json({ ok: true });
    })

    .get("/.well-known/jwks.json", async (c) => {
      const missing = missingOf(["AUTH_PRIVATE_KEY_JWK", "SITE_URL"]);
      if (missing.length > 0) return c.json(notConfigured(missing), 500);
      c.header("Cache-Control", "public, max-age=300");
      return c.json(await jwt().jwks());
    })

    // デモ・E2E 用。本番（NOGIKU_MOCK_ENABLED が true でない）では経路ごと無い
    .post("/auth/mock", async (c) => {
      if (!mock) return c.notFound();
      const missing = missingOf([...base]);
      if (missing.length > 0) return c.json(notConfigured(missing), 500);
      const body = await readBody(c.req.raw);
      const challenge = challengeOf(body.challenge);
      if (!challenge) return c.json({ code: "challenge_required", details: {} }, 400);
      const sub = str(body.sub) ?? MOCK_DEFAULT.sub;
      const hurigana =
        str(body.hurigana) ?? (sub === MOCK_DEFAULT.sub ? MOCK_DEFAULT.hurigana : undefined);
      const profile: AuthProfile = {
        sub,
        name: typeof body.name === "string" ? body.name : MOCK_DEFAULT.name,
        email: typeof body.email === "string" ? body.email : `${sub}@example.invalid`,
        ...(hurigana ? { hurigana } : {}),
      };
      return c.json({ code: await signedIn(profile, "nogiku_mock", challenge) });
    });

  return app;
}

function oidcOf(env: AuthEnv, fetchImpl: typeof fetch, now: () => number) {
  const { NOGIKU_CLIENT_ID: clientId, NOGIKU_CLIENT_SECRET: clientSecret } = env;
  const { NOGIKU_ISSUER: issuer, SITE_URL: site } = env;
  if (!clientId || !clientSecret || !issuer || !site) return null;
  return createOidc(
    {
      clientId,
      clientSecret,
      issuer,
      redirectUri: `${site.replace(/\/+$/, "")}/auth/callback`,
      access: readNogikuAccessConfig(env),
    },
    fetchImpl,
    now,
  );
}
