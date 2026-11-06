import { orgPermissionCatalog } from "@mf100/domain";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import Nogiku from "./nogiku.ts";

const options = { clientId: "c", clientSecret: "s", issuer: "https://auth.example/api" };
const access = {
  apiUrl: "https://access.example/api",
  organization: "org",
  systemId: "sys",
};
const names = orgPermissionCatalog.map((p) => p.name);

// OAuthConfig の profile は型上 optional なので、呼び出しだけここで絞る
type ProfileFn = (
  profile: Record<string, unknown>,
  tokens: { access_token?: string },
) => Promise<Record<string, unknown>>;
const profileOf = (p: ReturnType<typeof Nogiku>) => p.profile as unknown as ProfileFn;

afterEach(() => vi.unstubAllGlobals());

describe("Nogiku provider", () => {
  it("連携設定なしでは scope は従来どおりで resource を付けない", () => {
    expect(Nogiku(options).authorization).toEqual({
      params: { scope: "openid profile email" },
    });
  });

  it("連携設定ありでは Access の scope と resource を認可リクエストに足す", () => {
    expect(Nogiku(options, access).authorization).toEqual({
      params: {
        scope: "openid profile email https://access.example/api/permissions.read",
        resource: "https://access.example/api",
      },
    });
  });

  it("profile は sub を返す（Convex Auth が id を取り除いても subject が残る）", async () => {
    const result = await profileOf(Nogiku(options))({ sub: "u1", email: "A@Example.com" }, {});
    expect(result).toMatchObject({ id: "u1", sub: "u1", email: "a@example.com" });
    expect(result).not.toHaveProperty("orgPermissions");
  });

  it("連携ありでアクセストークンがあれば orgPermissions を足す", async () => {
    const fetchMock = vi.fn(async () => Response.json({ valid: false, missing: [names[0]] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await profileOf(Nogiku(options, access))({ sub: "u1" }, { access_token: "tok" });
    expect(result.orgPermissions).toEqual(names.slice(1));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("取得に失敗してもログインは続き、orgPermissions を含めない（保存値を変えない）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const result = await profileOf(Nogiku(options, access))({ sub: "u1" }, { access_token: "tok" });
    expect(result).toMatchObject({ id: "u1", sub: "u1" });
    expect(result).not.toHaveProperty("orgPermissions");
  });

  it("アクセストークンが無ければ API を呼ばない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await profileOf(Nogiku(options, access))({ sub: "u1" }, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
