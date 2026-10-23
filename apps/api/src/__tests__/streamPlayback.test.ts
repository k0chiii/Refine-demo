import { afterEach, expect, it, vi } from "vite-plus/test";
import { streamPlayback } from "../streamProcessing";
import type { ProcessingEnv } from "../processFileJob";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = {
  STREAM_ACCOUNT_ID: "b".repeat(32),
  STREAM_API_TOKEN: "test-only",
} as unknown as ProcessingEnv;

function playbackJwt(exp: number, mark: string) {
  const payload = btoa(JSON.stringify({ exp, mark }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function mediaToken(url: string) {
  return url.slice("https://videodelivery.net/".length).split("/")[0] ?? "";
}

function stubPlayback(rejectStatus?: number) {
  const posts: string[] = [];
  const media: string[] = [];
  let mediaCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url.endsWith("/token") && init?.method === "POST") {
        const asked = JSON.parse(String(init.body)).exp as number;
        const token = playbackJwt(asked + 86_400, String(posts.length + 1));
        posts.push(token);
        return Response.json({ result: { token } });
      }
      if (url.startsWith("https://videodelivery.net/")) {
        media.push(url);
        mediaCalls += 1;
        if (rejectStatus && mediaCalls === 2) return new Response("no", { status: rejectStatus });
        if (url.endsWith("missing.ts")) return new Response(null, { status: 404 });
        const manifest = url.endsWith(".m3u8");
        return new Response(manifest ? "#EXTM3U\nseg.ts\n" : "media", {
          status: 200,
          headers: {
            "Content-Type": manifest ? "application/vnd.apple.mpegurl" : "video/mp2t",
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
  return { posts, media };
}

it("同じ呼び出し元と動画では有効期限内の再生トークンを再発行せず、マニフェストにトークンを出さない", async () => {
  const start = 1_700_000_000_000;
  const now = vi.spyOn(Date, "now").mockReturnValue(start);
  const { posts, media } = stubPlayback();
  const uid = "1".repeat(32);
  const manifest = await streamPlayback(env, uid, "job-1", "manifest/video.m3u8", "viewer-reuse");
  const text = await manifest.text();
  expect(manifest.headers.get("Cache-Control")).toBe("private, no-store");
  expect(text).toBe("#EXTM3U\n/processing/stream/job-1/manifest/seg.ts\n");
  expect(text).not.toContain(posts[0]);
  const segment = await streamPlayback(env, uid, "job-1", "manifest/seg.ts", "viewer-reuse");
  expect(segment.status).toBe(200);
  expect(posts).toHaveLength(1);
  expect(mediaToken(media[1] ?? "")).toBe(posts[0]);
  now.mockReturnValue(start + 44_000);
  await streamPlayback(env, uid, "job-1", "manifest/seg.ts", "viewer-reuse");
  expect(posts).toHaveLength(1);
  now.mockReturnValue(start + 46_000);
  await streamPlayback(env, uid, "job-1", "manifest/seg.ts", "viewer-reuse");
  expect(posts).toHaveLength(2);
  expect(mediaToken(media.at(-1) ?? "")).toBe(posts[1]);
  expect(posts[1]).not.toBe(posts[0]);
});

it("別の呼び出し元、別の動画、空の呼び出し元では再生トークンを使い回さない", async () => {
  const { posts, media } = stubPlayback();
  const shared = "2".repeat(32);
  await streamPlayback(env, shared, "job-2", "manifest/seg.ts", "viewer-scope");
  await streamPlayback(env, shared, "job-2", "manifest/seg.ts", "viewer-other");
  await streamPlayback(env, "4".repeat(32), "job-4", "manifest/seg.ts", "viewer-scope");
  await streamPlayback(env, shared, "job-2", "manifest/seg.ts", "");
  await streamPlayback(env, shared, "job-2", "manifest/seg.ts", "");
  expect(posts).toHaveLength(5);
  expect(new Set(media.map(mediaToken)).size).toBe(5);
});

it("拒否されたキャッシュ済みトークンだけを捨てて、404 では取り直さない", async () => {
  const uid = "5".repeat(32);
  const rejected = stubPlayback(401);
  await streamPlayback(env, uid, "job-5", "manifest/seg.ts", "viewer-retry");
  const recovered = await streamPlayback(env, uid, "job-5", "manifest/seg.ts", "viewer-retry");
  expect(recovered.status).toBe(200);
  expect(await recovered.text()).toBe("media");
  expect(rejected.posts).toHaveLength(2);
  await streamPlayback(env, uid, "job-5", "manifest/seg.ts", "viewer-retry");
  expect(rejected.posts).toHaveLength(2);
  expect(mediaToken(rejected.media.at(-1) ?? "")).toBe(rejected.posts[1]);
  expect(mediaToken(rejected.media[1] ?? "")).toBe(rejected.posts[0]);

  vi.unstubAllGlobals();
  const missing = stubPlayback();
  const other = "6".repeat(32);
  await streamPlayback(env, other, "job-6", "manifest/seg.ts", "viewer-missing");
  const lost = await streamPlayback(env, other, "job-6", "missing.ts", "viewer-missing");
  expect(lost.status).toBe(404);
  expect(missing.posts).toHaveLength(1);
});

it("期限が読めない再生トークンは次のセグメントで再発行する", async () => {
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = input instanceof URL ? input.href : String(input);
      if (url.endsWith("/token") && init?.method === "POST") {
        const token = `opaque-${posts.length + 1}`;
        posts.push(token);
        return Response.json({ result: { token } });
      }
      return new Response("media", { status: 200, headers: { "Content-Type": "video/mp2t" } });
    }),
  );
  const uid = "7".repeat(32);
  await streamPlayback(env, uid, "job-7", "seg.ts", "viewer-opaque");
  await streamPlayback(env, uid, "job-7", "seg.ts", "viewer-opaque");
  expect(posts).toEqual(["opaque-1", "opaque-2"]);
});
