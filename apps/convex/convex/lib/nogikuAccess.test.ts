import { orgPermissionCatalog } from "@mf100/domain";
import { describe, expect, it, vi } from "vite-plus/test";
import { fetchOrgPermissions, readNogikuAccessConfig } from "./nogikuAccess.ts";

const config = {
  apiUrl: "https://access.example/api",
  organization: "org",
  systemId: "00000000-0000-0000-0000-000000000000",
};
const names = orgPermissionCatalog.map((p) => p.name);

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);

describe("Nogiku Access 連携の設定", () => {
  it("3 つ揃ったときだけ有効で、apiUrl の末尾スラッシュは落とす", () => {
    expect(
      readNogikuAccessConfig({
        NOGIKU_ACCESS_API_URL: "https://access.example/api/",
        NOGIKU_ACCESS_ORG_SLUG: "org",
        NOGIKU_ACCESS_SYSTEM_ID: "sys",
      }),
    ).toEqual({ apiUrl: "https://access.example/api", organization: "org", systemId: "sys" });
  });

  it("1 つでも欠ければ無効（部分設定で壊れた URL を叩かない）", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readNogikuAccessConfig({})).toBeUndefined();
    expect(
      readNogikuAccessConfig({ NOGIKU_ACCESS_API_URL: "https://access.example/api" }),
    ).toBeUndefined();
  });
});

describe("組織権限の取得（permission/check）", () => {
  it("URL・Bearer・body を契約どおりに組み立て、要求した権限から missing を引いて返す", async () => {
    const fetchMock = vi.fn(async () => json({ valid: false, missing: [names[1]] }));
    const granted = await fetchOrgPermissions(config, "tok", fetchMock as unknown as typeof fetch);

    expect(granted).toEqual([names[0]]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://access.example/api/permission/check");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({
      organization: "org",
      systemId: config.systemId,
      permissions: names,
    });
  });

  it("missing が空なら全部持っている", async () => {
    const f = async () => json({ valid: true, missing: [] });
    expect(await fetchOrgPermissions(config, "t", f as unknown as typeof fetch)).toEqual(names);
  });

  it("全部足りないときは空配列（undefined ではない）", async () => {
    const f = async () => json({ valid: false, missing: names });
    expect(await fetchOrgPermissions(config, "t", f as unknown as typeof fetch)).toEqual([]);
  });

  describe("取得できなければ undefined（throw しない）", () => {
    const run = (f: () => Promise<Response>, timeoutMs?: number) =>
      fetchOrgPermissions(config, "t", f as unknown as typeof fetch, timeoutMs);

    it("ネットワークエラー", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await run(() => Promise.reject(new TypeError("network")))).toBeUndefined();
    });

    it("非 2xx", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await run(async () => json({ error: "x" }, { status: 401 }))).toBeUndefined();
    });

    it("形の合わない応答", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const body of [{}, null, "ok", { valid: true }, { valid: true, missing: [1] }])
        expect(await run(async () => json(body)), JSON.stringify(body)).toBeUndefined();
      expect(await run(async () => new Response("not json"))).toBeUndefined();
    });

    it("valid と missing が食い違う応答（権限を付けすぎない）", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const body of [
        { valid: false, missing: [] },
        { valid: false, missing: ["unknown:permission"] },
        { valid: true, missing: [names[0]] },
      ])
        expect(await run(async () => json(body)), JSON.stringify(body)).toBeUndefined();
    });

    it("タイムアウト（応答が来ない API でログインを止めない）", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const hang = (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      expect(
        await fetchOrgPermissions(config, "t", hang as unknown as typeof fetch, 10),
      ).toBeUndefined();
    });
  });
});
