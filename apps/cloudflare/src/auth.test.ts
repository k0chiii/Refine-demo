import { orgPermissionCatalog } from "@mf100/domain";
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from "jose";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { authApp } from "./auth/app.ts";
import type { AuthEnv } from "./auth/env.ts";
import { jwtIdentifier } from "./auth/identify.ts";
import { createAuthStore, migrateAuth, randomToken, sha256Base64url } from "./auth/store.ts";
import { migrate } from "./sqlite/schema.ts";
import { nodeSql } from "./testing/context.ts";

const SITE = "https://api.mf100.test";
const FRONTEND = "https://app.mf100.test";
const ISSUER = "https://auth.nogiku.test/api";
const START = Date.UTC(2026, 10, 6);

let privateJwk: string;
beforeAll(async () => {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  privateJwk = JSON.stringify(await exportJWK(privateKey));
});

const baseEnv = (): AuthEnv => ({
  AUTH_PRIVATE_KEY_JWK: privateJwk,
  SITE_URL: SITE,
  FRONTEND_URL: FRONTEND,
});

/** 時計と SQLite は 1 組。DO の代わりに、同じ SQLite のアダプタを Node の中で直に包む */
function setup(env: AuthEnv, fetchImpl?: typeof fetch) {
  const sql = nodeSql();
  migrate(sql);
  migrateAuth(sql);
  const clock = { t: START };
  const now = () => clock.t;
  const store = createAuthStore(sql, now);
  const app = authApp({ store: () => store, env, now, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const identify = jwtIdentifier(env, now);
  const bearer = (token: string) =>
    new Request(`${SITE}/u/x`, { headers: { Authorization: `Bearer ${token}` } });
  return { sql, clock, store, app, post, identify, bearer };
}

type Setup = ReturnType<typeof setup>;
type Tokens = { accessToken: string; refreshToken: string };

const mockEnv = (): AuthEnv => ({ ...baseEnv(), NOGIKU_MOCK_ENABLED: "true" });

/** Web がサインインの前に作る組。verifier はブラウザに残り、challenge だけがサーバーへ行く */
async function pkce() {
  const verifier = randomToken();
  return { verifier, challenge: await sha256Base64url(verifier) };
}

/** モックでサインインして、一時コードを access / refresh に替えるところまで */
async function mockSignIn(s: Setup, body: Record<string, unknown> = { sub: "sub-1" }) {
  const { verifier, challenge } = await pkce();
  const { code } = (await (await s.post("/auth/mock", { ...body, challenge })).json()) as {
    code: string;
  };
  const res = await s.post("/auth/token", { code, verifier });
  return { code, verifier, res, tokens: (await res.json()) as Tokens };
}

describe("モックのサインイン", () => {
  it("一周する: /auth/mock → /auth/token → Bearer で本人が分かる", async () => {
    const s = setup(mockEnv());
    const { res, tokens } = await mockSignIn(s, {
      sub: "sub-1",
      name: "山田 太郎",
      hurigana: "やまだ たろう",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const who = await s.identify(s.bearer(tokens.accessToken));
    expect(who).not.toBeNull();
    const [user] = s.sql.exec("SELECT doc FROM users WHERE id = ?", who!.userId);
    expect(JSON.parse(user!.doc as string)).toMatchObject({
      subject: "sub-1",
      name: "やまだ たろう", // 表示名はふりがな
      nameKanji: "山田 太郎",
      source: "nogiku_mock",
    });
  });

  it("同じ sub は同じ利用者に戻り、サインインごとにセッションが替わる", async () => {
    const s = setup(mockEnv());
    const a = await s.identify(s.bearer((await mockSignIn(s)).tokens.accessToken));
    const b = await s.identify(s.bearer((await mockSignIn(s)).tokens.accessToken));
    expect(b!.userId).toBe(a!.userId);
    expect(b!.sessionId).not.toBe(a!.sessionId);
  });

  it("既定の利用者は sub を省いたとき", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s, {});
    const who = await s.identify(s.bearer(tokens.accessToken));
    const [user] = s.sql.exec("SELECT doc FROM users WHERE id = ?", who!.userId);
    expect(JSON.parse(user!.doc as string)).toMatchObject({
      subject: "mock-nogiku-creator",
      name: "さつき めい",
    });
  });

  it("モックが無効なら /auth/mock は無い。有効なら本物の入口 /auth/signin が無い", async () => {
    const off = setup(baseEnv());
    expect((await off.post("/auth/mock", { sub: "x" })).status).toBe(404);
    const on = setup(mockEnv());
    expect((await on.app.request("/auth/signin")).status).toBe(404);
  });
});

describe("一時コード", () => {
  it("1 回しか使えない", async () => {
    const s = setup(mockEnv());
    const { code, verifier } = await mockSignIn(s);
    expect((await s.post("/auth/token", { code, verifier })).status).toBe(401);
  });

  it("60 秒を過ぎたら使えない", async () => {
    const s = setup(mockEnv());
    const { verifier, challenge } = await pkce();
    const { code } = (await (await s.post("/auth/mock", { sub: "a", challenge })).json()) as {
      code: string;
    };
    s.clock.t += 61_000;
    expect((await s.post("/auth/token", { code, verifier })).status).toBe(401);
  });

  it("知らないコード・コード無しは 401", async () => {
    const s = setup(mockEnv());
    expect((await s.post("/auth/token", { code: "nope" })).status).toBe(401);
    expect((await s.post("/auth/token", {})).status).toBe(401);
  });

  it("challenge の無い・形の違う /auth/mock は 400 challenge_required で、コードを出さない", async () => {
    const s = setup(mockEnv());
    for (const body of [
      { sub: "a" },
      { sub: "a", challenge: "short" },
      { sub: "a", challenge: 1 },
    ]) {
      const res = await s.post("/auth/mock", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "challenge_required", details: {} });
    }
    expect(s.sql.exec("SELECT count(*) AS n FROM authCodes")[0]!.n).toBe(0);
  });

  it("verifier が違う・無いなら 401 invalid_code で、そのコードは正しい verifier でも使えなくなる", async () => {
    const s = setup(mockEnv());
    const mine = await pkce();
    const thief = await pkce();
    const issue = async () =>
      (
        (await (await s.post("/auth/mock", { sub: "a", challenge: mine.challenge })).json()) as {
          code: string;
        }
      ).code;

    const stolen = await issue();
    const wrong = await s.post("/auth/token", { code: stolen, verifier: thief.verifier });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ code: "invalid_code", details: {} });
    expect((await s.post("/auth/token", { code: stolen, verifier: mine.verifier })).status).toBe(
      401,
    );

    // verifier を付けないのも同じ
    const bare = await issue();
    expect((await s.post("/auth/token", { code: bare })).status).toBe(401);
    expect((await s.post("/auth/token", { code: bare, verifier: mine.verifier })).status).toBe(401);

    // 持ち主の verifier なら通る
    const ok = await issue();
    expect((await s.post("/auth/token", { code: ok, verifier: mine.verifier })).status).toBe(200);
  });
});

describe("refresh", () => {
  it("回転すると古いものは使えない", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    const res = await s.post("/auth/refresh", { refreshToken: tokens.refreshToken });
    expect(res.status).toBe(200);
    const next = (await res.json()) as Tokens;
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect(await s.identify(s.bearer(next.accessToken))).not.toBeNull();

    expect((await s.post("/auth/refresh", { refreshToken: tokens.refreshToken })).status).toBe(401);
    // 新しい方は回転を続けられる
    expect((await s.post("/auth/refresh", { refreshToken: next.refreshToken })).status).toBe(200);
  });

  it("同じセッションのまま回る（sub のセッション部分は変わらない）", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    const next = (await (
      await s.post("/auth/refresh", { refreshToken: tokens.refreshToken })
    ).json()) as Tokens;
    const before = await s.identify(s.bearer(tokens.accessToken));
    const after = await s.identify(s.bearer(next.accessToken));
    expect(after).toEqual(before);
  });

  it("signout のあとの refresh は失敗する。signout は何度呼んでも成功", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    expect((await s.post("/auth/signout", { refreshToken: tokens.refreshToken })).status).toBe(200);
    expect((await s.post("/auth/refresh", { refreshToken: tokens.refreshToken })).status).toBe(401);
    expect((await s.post("/auth/signout", { refreshToken: tokens.refreshToken })).status).toBe(200);
    expect((await s.post("/auth/signout", {})).status).toBe(200);
  });

  it("期限（30 日）を過ぎたら使えない", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    s.clock.t += 31 * 24 * 60 * 60_000;
    expect((await s.post("/auth/refresh", { refreshToken: tokens.refreshToken })).status).toBe(401);
  });

  it("保存されるのは hash で、refresh そのものは DB に無い", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    const rows = s.sql.exec("SELECT refreshHash FROM authSessions");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refreshHash).not.toBe(tokens.refreshToken);
  });
});

describe("JWT と JWKS", () => {
  it("sub は `利用者ID|セッションID`。iss は SITE_URL、aud は convex、有効は 1 時間", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    const payload = JSON.parse(
      atob(tokens.accessToken.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    );
    const who = await s.identify(s.bearer(tokens.accessToken));
    expect(payload.sub).toBe(`${who!.userId}|${who!.sessionId}`);
    expect(payload.sub.split("|")).toHaveLength(2);
    expect(payload.iss).toBe(SITE);
    expect(payload.aud).toBe("convex");
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it("公開する JWKS だけで、apps/api と同じ検証（issuer・audience）が通る", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    const res = await s.app.request("/.well-known/jwks.json");
    expect(res.status).toBe(200);
    const jwks = (await res.json()) as { keys: Record<string, unknown>[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).not.toHaveProperty("d");
    const { payload } = await jwtVerify(tokens.accessToken, createLocalJWKSet(jwks as never), {
      issuer: SITE,
      audience: "convex",
      currentDate: new Date(s.clock.t),
    });
    expect(typeof payload.sub).toBe("string");
  });

  it("別の鍵で署名したもの・期限切れ・別の発行者は本人にならない", async () => {
    const s = setup(mockEnv());
    const { tokens } = await mockSignIn(s);
    const other = setup({
      ...mockEnv(),
      AUTH_PRIVATE_KEY_JWK: JSON.stringify(
        await exportJWK((await generateKeyPair("ES256", { extractable: true })).privateKey),
      ),
    });
    const forged = (await mockSignIn(other)).tokens.accessToken;
    expect(await s.identify(s.bearer(forged))).toBeNull();

    s.clock.t += 3601_000;
    expect(await s.identify(s.bearer(tokens.accessToken))).toBeNull();

    const elsewhere = setup({ ...mockEnv(), SITE_URL: "https://other.test" });
    expect(await elsewhere.identify(elsewhere.bearer(tokens.accessToken))).toBeNull();
  });

  it("Bearer が無い・形が違うときは null", async () => {
    const s = setup(mockEnv());
    expect(await s.identify(new Request(`${SITE}/u/x`))).toBeNull();
    expect(await s.identify(s.bearer("not-a-jwt"))).toBeNull();
    expect(
      await s.identify(new Request(`${SITE}/u/x`, { headers: { Authorization: "Basic abc" } })),
    ).toBeNull();
  });
});

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** Nogiku の代役。呼ばれた URL と、token に来た verifier を覚える */
function fakeNogiku(opts: { sub?: string; nonce?: () => string; permissions?: unknown } = {}) {
  const seen = {
    calls: [] as string[],
    tokenBody: null as URLSearchParams | null,
    tokenAuth: "",
    checked: false,
  };
  const sub = opts.sub ?? "nogiku-sub-1";
  const unsigned = (claims: object) => {
    const enc = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    return `${enc({ alg: "none" })}.${enc(claims)}.`;
  };
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    seen.calls.push(url);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url === `${ISSUER}/.well-known/openid-configuration`)
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
      });
    if (url === `${ISSUER}/oauth2/token`) {
      seen.tokenBody = new URLSearchParams(init?.body as URLSearchParams);
      seen.tokenAuth = new Headers(init?.headers).get("Authorization") ?? "";
      return json({
        access_token: "at-1",
        token_type: "Bearer",
        id_token: unsigned({
          iss: ISSUER,
          aud: "client-1",
          sub,
          nonce: opts.nonce?.() ?? "",
          exp: Math.floor(START / 1000) + 300,
        }),
      });
    }
    if (url === `${ISSUER}/oauth2/userinfo`)
      return json({
        sub,
        name: "山田 太郎",
        email: "Taro@Example.COM",
        picture: "https://img.test/a.png",
        hurigana: "やまだ たろう",
        generation: 76,
      });
    if (url === "https://engine.nogiku.test/api/permission/check") {
      seen.checked = true;
      return opts.permissions === undefined
        ? json({ valid: true, missing: [] })
        : json(opts.permissions);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { seen, impl };
}

const oidcEnv = (): AuthEnv => ({
  ...baseEnv(),
  NOGIKU_CLIENT_ID: "client-1",
  NOGIKU_CLIENT_SECRET: "secret-1",
  NOGIKU_ISSUER: ISSUER,
});

/** /auth/signin を踏み、Nogiku へ向かう URL と、Web が持つ verifier を返す */
async function signIn(s: Setup, query = "redirectTo=/works%2F1") {
  const { verifier, challenge } = await pkce();
  const res = await s.app.request(
    `/auth/signin?provider=nogiku&${query}&challenge=${encodeURIComponent(challenge)}`,
  );
  const location = res.headers.get("location");
  return { res, url: location ? new URL(location) : null, verifier };
}

describe("OIDC（Nogiku）", () => {
  it("signin → callback → token を、fetch の差し替えで一周する", async () => {
    let nonce = "";
    const nogiku = fakeNogiku({ nonce: () => nonce });
    const s = setup(oidcEnv(), nogiku.impl);

    const { res, url, verifier } = await signIn(s);
    expect(res.status).toBe(302);
    expect(url!.origin + url!.pathname).toBe(`${ISSUER}/oauth2/authorize`);
    const q = url!.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe("client-1");
    expect(q.get("redirect_uri")).toBe(`${SITE}/auth/callback`);
    expect(q.get("scope")).toBe("openid profile email");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("resource")).toBeNull();
    nonce = q.get("nonce")!;

    const cb = await s.app.request(`/auth/callback?code=nogiku-code&state=${q.get("state")}`);
    expect(cb.status).toBe(302);
    const back = new URL(cb.headers.get("location")!);
    // トークンは URL に出ず、一時コードだけ
    expect(back.origin + back.pathname).toBe(`${FRONTEND}/works/1`);
    expect([...back.searchParams.keys()]).toEqual(["code"]);

    // token には PKCE の verifier が渡り、その SHA-256 が最初の code_challenge と一致する
    const body = nogiku.seen.tokenBody!;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("nogiku-code");
    expect(body.get("redirect_uri")).toBe(`${SITE}/auth/callback`);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body.get("code_verifier")!),
    );
    expect(
      btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
    ).toBe(q.get("code_challenge"));
    expect(nogiku.seen.tokenAuth).toBe(`Basic ${btoa("client-1:secret-1")}`);

    const tokenRes = await s.post("/auth/token", {
      code: back.searchParams.get("code"),
      verifier,
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as Tokens;
    const who = await s.identify(s.bearer(tokens.accessToken));
    const [user] = s.sql.exec("SELECT doc FROM users WHERE id = ?", who!.userId);
    expect(JSON.parse(user!.doc as string)).toMatchObject({
      subject: "nogiku-sub-1",
      name: "やまだ たろう",
      nameKanji: "山田 太郎",
      email: "taro@example.com", // 小文字にそろえる
      picture: "https://img.test/a.png",
      generation: 76,
      source: "nogiku",
      isSystemAdmin: false,
    });
    // 組織権限の設定が無ければ取りに行かない
    expect(nogiku.seen.checked).toBe(false);
  });

  it("signin に challenge が無い・形が違うなら 400 challenge_required で、state も残さない", async () => {
    const s = setup(oidcEnv(), fakeNogiku().impl);
    for (const q of ["", "&challenge=short"]) {
      const res = await s.app.request(`/auth/signin?provider=nogiku&redirectTo=/${q}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: "challenge_required", details: {} });
    }
    expect(s.sql.exec("SELECT count(*) AS n FROM authStates")[0]!.n).toBe(0);
  });

  it("callback の一時コードは signin の challenge に結び付く: 別の verifier では 401、そのコードも使えなくなる", async () => {
    let nonce = "";
    const s = setup(oidcEnv(), fakeNogiku({ nonce: () => nonce }).impl);
    const codeOf = async () => {
      const { url, verifier } = await signIn(s);
      nonce = url!.searchParams.get("nonce")!;
      const cb = await s.app.request(
        `/auth/callback?code=c&state=${url!.searchParams.get("state")}`,
      );
      return { code: new URL(cb.headers.get("location")!).searchParams.get("code"), verifier };
    };

    const stolen = await codeOf();
    const thief = await pkce();
    expect(
      (await s.post("/auth/token", { code: stolen.code, verifier: thief.verifier })).status,
    ).toBe(401);
    expect((await s.post("/auth/token", stolen)).status).toBe(401);

    const mine = await codeOf();
    expect((await s.post("/auth/token", mine)).status).toBe(200);
  });

  it("組織権限は設定が揃っているときだけ取り、scope と resource も変わる", async () => {
    let nonce = "";
    const missing = orgPermissionCatalog[0]!.name;
    const nogiku = fakeNogiku({
      nonce: () => nonce,
      permissions: { valid: false, missing: [missing] },
    });
    const s = setup(
      {
        ...oidcEnv(),
        NOGIKU_ACCESS_API_URL: "https://engine.nogiku.test/api/",
        NOGIKU_ACCESS_ORG_SLUG: "mf",
        NOGIKU_ACCESS_SYSTEM_ID: "mf100",
        MF100_SYSTEM_ADMIN_SUBJECTS: "other, nogiku-sub-1",
      },
      nogiku.impl,
    );
    const { url, verifier } = await signIn(s);
    expect(url!.searchParams.get("scope")).toBe(
      "openid profile email https://engine.nogiku.test/api/permissions.read",
    );
    expect(url!.searchParams.get("resource")).toBe("https://engine.nogiku.test/api");
    nonce = url!.searchParams.get("nonce")!;

    const cb = await s.app.request(`/auth/callback?code=c&state=${url!.searchParams.get("state")}`);
    const code = new URL(cb.headers.get("location")!).searchParams.get("code");
    const tokens = (await (await s.post("/auth/token", { code, verifier })).json()) as Tokens;
    const who = await s.identify(s.bearer(tokens.accessToken));
    const doc = JSON.parse(
      s.sql.exec("SELECT doc FROM users WHERE id = ?", who!.userId)[0]!.doc as string,
    );
    expect(doc.orgPermissions).toEqual(
      orgPermissionCatalog.map((p) => p.name).filter((n) => n !== missing),
    );
    expect(doc.isSystemAdmin).toBe(true); // ブートストラップ管理者
  });

  it("組織権限が取れなくても落ちず、保存済みの権限は消えない", async () => {
    let nonce = "";
    const nogiku = fakeNogiku({ nonce: () => nonce, permissions: { valid: true } }); // 形が違う応答
    const s = setup(
      {
        ...oidcEnv(),
        NOGIKU_ACCESS_API_URL: "https://engine.nogiku.test/api",
        NOGIKU_ACCESS_ORG_SLUG: "mf",
        NOGIKU_ACCESS_SYSTEM_ID: "mf100",
      },
      nogiku.impl,
    );
    const userId = await s.store.upsertUserFromProfile(
      { sub: "nogiku-sub-1", orgPermissions: ["works:create"] },
      { source: "nogiku", admin: false },
    );
    const { url } = await signIn(s);
    nonce = url!.searchParams.get("nonce")!;
    const cb = await s.app.request(`/auth/callback?code=c&state=${url!.searchParams.get("state")}`);
    expect(cb.status).toBe(302);
    const doc = JSON.parse(
      s.sql.exec("SELECT doc FROM users WHERE id = ?", userId)[0]!.doc as string,
    );
    expect(doc.orgPermissions).toEqual(["works:create"]);
    expect(s.sql.exec("SELECT count(*) AS n FROM users")[0]!.n).toBe(1);
  });

  it("state が合わなければ 400。state は 1 回しか使えない", async () => {
    let nonce = "";
    const nogiku = fakeNogiku({ nonce: () => nonce });
    const s = setup(oidcEnv(), nogiku.impl);
    const { url } = await signIn(s);
    nonce = url!.searchParams.get("nonce")!;

    const wrong = await s.app.request("/auth/callback?code=c&state=forged");
    expect(wrong.status).toBe(400);
    expect(nogiku.seen.tokenBody).toBeNull(); // Nogiku には何も送っていない

    const state = url!.searchParams.get("state");
    expect((await s.app.request(`/auth/callback?code=c&state=${state}`)).status).toBe(302);
    expect((await s.app.request(`/auth/callback?code=c&state=${state}`)).status).toBe(400);
    expect((await s.app.request("/auth/callback")).status).toBe(400);
  });

  it("state は 10 分で切れる", async () => {
    const s = setup(oidcEnv(), fakeNogiku().impl);
    const { url } = await signIn(s);
    s.clock.t += 11 * 60_000;
    expect(
      (await s.app.request(`/auth/callback?code=c&state=${url!.searchParams.get("state")}`)).status,
    ).toBe(400);
  });

  it("nonce が違う id_token は受けない（別の認可リクエストへの応答）", async () => {
    const s = setup(oidcEnv(), fakeNogiku({ nonce: () => "someone-elses" }).impl);
    const { url } = await signIn(s);
    const cb = await s.app.request(`/auth/callback?code=c&state=${url!.searchParams.get("state")}`);
    expect(cb.status).toBe(502);
    expect(s.sql.exec("SELECT count(*) AS n FROM users")[0]!.n).toBe(0);
  });

  it("Nogiku が token を拒んだら 502 で、利用者は作られない", async () => {
    const failing = (async (input: RequestInfo | URL) =>
      urlOf(input).endsWith("/token")
        ? new Response("no", { status: 400 })
        : fakeNogiku().impl(input)) as typeof fetch;
    const s = setup(oidcEnv(), failing);
    const { url } = await signIn(s);
    const cb = await s.app.request(`/auth/callback?code=c&state=${url!.searchParams.get("state")}`);
    expect(cb.status).toBe(502);
    expect(s.sql.exec("SELECT count(*) AS n FROM users")[0]!.n).toBe(0);
  });

  it("redirectTo は FRONTEND_URL の中だけ。外へは行かない", async () => {
    const s = setup(oidcEnv(), fakeNogiku().impl);
    for (const bad of [
      "https://evil.test/",
      "//evil.test",
      `${FRONTEND}.evil.test/`,
      "javascript:alert(1)",
    ])
      expect((await signIn(s, `redirectTo=${encodeURIComponent(bad)}`)).res.status).toBe(400);
    expect((await signIn(s, `redirectTo=${encodeURIComponent(`${FRONTEND}/ok`)}`)).res.status).toBe(
      302,
    );
    // 省いたら Web の入口へ
    expect((await signIn(s, "")).res.status).toBe(302);
  });

  it("provider が nogiku でなければ 400。設定が足りなければ 500", async () => {
    const s = setup(oidcEnv(), fakeNogiku().impl);
    expect((await s.app.request("/auth/signin?provider=github")).status).toBe(400);
    const bare = setup({ ...baseEnv() });
    const res = await bare.app.request("/auth/signin");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "auth_not_configured" });
  });
});

describe("利用者の保存", () => {
  it("sub で引き、同じ人は同じ ID。取れなかった項目は消さない", async () => {
    const s = setup(mockEnv());
    const a = await s.store.upsertUserFromProfile(
      {
        sub: "x",
        name: "山田",
        hurigana: "やまだ",
        email: "a@b.test",
        orgPermissions: ["works:create"],
      },
      { source: "nogiku", admin: false },
    );
    const b = await s.store.upsertUserFromProfile({ sub: "x" }, { source: "nogiku", admin: true });
    expect(b).toBe(a);
    const doc = JSON.parse(s.sql.exec("SELECT doc FROM users WHERE id = ?", a)[0]!.doc as string);
    expect(doc).toMatchObject({
      name: "やまだ",
      nameKanji: "山田",
      email: "a@b.test",
      orgPermissions: ["works:create"],
      isSystemAdmin: true,
    });
    // 管理者は一度なったら、次のログインで外れない
    await s.store.upsertUserFromProfile({ sub: "x" }, { source: "nogiku", admin: false });
    expect(
      JSON.parse(s.sql.exec("SELECT doc FROM users WHERE id = ?", a)[0]!.doc as string)
        .isSystemAdmin,
    ).toBe(true);
  });

  it("ふりがなが無い人は漢字の名前が表示名", async () => {
    const s = setup(mockEnv());
    const id = await s.store.upsertUserFromProfile(
      { sub: "y", name: "鈴木" },
      { source: "nogiku", admin: false },
    );
    expect(
      JSON.parse(s.sql.exec("SELECT doc FROM users WHERE id = ?", id)[0]!.doc as string),
    ).toMatchObject({ name: "鈴木", nameKanji: "鈴木" });
  });

  it("migrateAuth は何度呼んでも同じ。subject は unique", () => {
    const s = setup(mockEnv());
    migrateAuth(s.sql);
    s.sql.exec("INSERT INTO users (id, doc) VALUES ('u1', '{\"subject\":\"dup\"}')");
    expect(() =>
      s.sql.exec("INSERT INTO users (id, doc) VALUES ('u2', '{\"subject\":\"dup\"}')"),
    ).toThrow();
    // subject を持たない行（既存の名簿）は何行あっても構わない
    s.sql.exec("INSERT INTO users (id, doc) VALUES ('u3', '{}')");
    s.sql.exec("INSERT INTO users (id, doc) VALUES ('u4', '{}')");
  });

  it("sweep は期限切れだけを消す", async () => {
    const s = setup(mockEnv());
    await mockSignIn(s); // セッション 1（コードは使用済み）
    const live = await s.store.createSession("u");
    await s.store.issueCode(live.sessionId, "c");
    await s.store.putState({
      state: "st",
      verifier: "v",
      nonce: "n",
      redirectTo: FRONTEND,
      challenge: "c",
    });
    s.clock.t += 11 * 60_000;
    await s.store.sweep();
    const n = (t: string) => s.sql.exec(`SELECT count(*) AS n FROM ${t}`)[0]!.n;
    expect([n("authCodes"), n("authStates"), n("authSessions")]).toEqual([0, 0, 2]);
    s.clock.t += 31 * 24 * 60 * 60_000;
    await s.store.sweep();
    expect(n("authSessions")).toBe(0);
  });
});
