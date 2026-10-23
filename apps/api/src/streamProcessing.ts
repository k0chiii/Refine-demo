import type { ProcessingEnv } from "./processFileJob";
import { processingGateway, type ProcessingJob } from "./processingGateway";

function streamApi(env: ProcessingEnv) {
  if (!env.STREAM_API_TOKEN || !/^[a-f0-9]{32}$/.test(env.STREAM_ACCOUNT_ID ?? ""))
    throw new Error("stream_not_configured");
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${env.STREAM_ACCOUNT_ID}/stream`,
    headers: { Authorization: `Bearer ${env.STREAM_API_TOKEN}` },
  };
}
export async function uploadStream(env: ProcessingEnv, info: ProcessingJob): Promise<string> {
  const api = streamApi(env);
  const jobId = info.job._id;
  const service = processingGateway(env.CONVEX_SITE_URL, env.PROCESSING_SECRET);
  if (!info.source) throw new Error("source_missing");
  const head = await env.ASSETS.head(info.source);
  if (!head) throw new Error("source_missing");
  let uploadUrl = info.job.streamUploadUrl;
  let uid = info.job.streamUid;
  if (!uploadUrl || !uid) {
    const response = await fetch(`${api.url}?direct_user=true`, {
      method: "POST",
      redirect: "error",
      headers: {
        ...api.headers,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(head.size),
        "Upload-Metadata": `requiresignedurls,name ${btoa(jobId)}`,
      },
    });
    uploadUrl = response.headers.get("Location") ?? undefined;
    uid = response.headers.get("Stream-Media-ID") ?? undefined;
    if (!response.ok || !uploadUrl || !uid) throw new Error("stream_reservation_failed");
    await service("streamSession", { jobId, uid, uploadUrl });
  }
  // Enforce and confirm privacy before any original bytes leave R2.
  const privacy = await fetch(`${api.url}/${uid}`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ requireSignedURLs: true }),
  });
  if (!privacy.ok) throw new Error("stream_privacy_update_failed");
  const verified = await fetch(`${api.url}/${uid}`, { headers: api.headers });
  const video = (await verified.json()) as { result?: { requireSignedURLs?: boolean } };
  if (!verified.ok || video.result?.requireSignedURLs !== true)
    throw new Error("stream_privacy_not_confirmed");
  // The URL is validated again before every retry, even though it came from the provider.
  const url = new URL(uploadUrl);
  if (
    url.protocol !== "https:" ||
    !["upload.videodelivery.net", "upload.cloudflarestream.com"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("invalid_stream_upload_url");
  await service("inspect", { jobId });
  const status = await fetch(url, {
    method: "HEAD",
    redirect: "error",
    headers: { "Tus-Resumable": "1.0.0" },
  });
  const offset = Number(status.headers.get("Upload-Offset"));
  if (!status.ok || !Number.isSafeInteger(offset) || offset < 0 || offset > head.size)
    throw new Error("stream_resume_failed");
  if (offset < head.size) {
    const source = await env.ASSETS.get(info.source, {
      range: { offset, length: head.size - offset },
    });
    if (!source) throw new Error("source_missing");
    const response = await fetch(url, {
      method: "PATCH",
      redirect: "error",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
        "Content-Length": String(head.size - offset),
      },
      body: source.body,
    });
    if (!response.ok || Number(response.headers.get("Upload-Offset")) !== head.size)
      throw new Error("stream_upload_failed");
  }
  return uid;
}

const PLAYBACK_TTL_SEC = 60;
const PLAYBACK_REUSE_SKEW_SEC = 15;
const PLAYBACK_CACHE_LIMIT = 128;
type PlaybackGrant = { token: string; exp: number };
/** Provider playback tokens in this isolate. Not an ACL result, and not shared across callers. */
const playbackGrants = new Map<string, PlaybackGrant>();

function grantKey(principal: string, uid: string): string {
  return `${principal}\n${uid}`;
}
function readTokenExp(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded =
      part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof json.exp === "number" && Number.isSafeInteger(json.exp) ? json.exp : null;
  } catch {
    return null;
  }
}
function takeGrant(principal: string, uid: string, nowSec: number): string | null {
  if (principal.length === 0) return null;
  const key = grantKey(principal, uid);
  const hit = playbackGrants.get(key);
  if (!hit || hit.exp <= nowSec + PLAYBACK_REUSE_SKEW_SEC) {
    if (hit) playbackGrants.delete(key);
    return null;
  }
  playbackGrants.delete(key);
  playbackGrants.set(key, hit);
  return hit.token;
}
function rememberGrant(
  principal: string,
  uid: string,
  token: string,
  requestedExp: number,
  nowSec: number,
) {
  if (principal.length === 0) return;
  const stated = readTokenExp(token);
  if (stated === null) return;
  const exp = Math.min(stated, requestedExp);
  if (exp <= nowSec + PLAYBACK_REUSE_SKEW_SEC) return;
  const key = grantKey(principal, uid);
  playbackGrants.delete(key);
  playbackGrants.set(key, { token, exp });
  if (playbackGrants.size <= PLAYBACK_CACHE_LIMIT) return;
  for (const [stored, grant] of playbackGrants) {
    if (grant.exp <= nowSec) playbackGrants.delete(stored);
  }
  while (playbackGrants.size > PLAYBACK_CACHE_LIMIT) {
    const oldest = playbackGrants.keys().next().value;
    if (oldest === undefined) break;
    playbackGrants.delete(oldest);
  }
}
async function issuePlaybackToken(
  api: { url: string; headers: { Authorization: string } },
  uid: string,
  nowSec: number,
): Promise<{ token: string; exp: number }> {
  const exp = nowSec + PLAYBACK_TTL_SEC;
  const response = await fetch(`${api.url}/${uid}/token`, {
    method: "POST",
    headers: { ...api.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ exp }),
  });
  const tokenResult = (await response.json()) as { result?: { token?: string } };
  const token = tokenResult.result?.token;
  if (!response.ok || !token || !/^[A-Za-z0-9_.-]+$/.test(token))
    throw new Error("stream_token_failed");
  return { token, exp };
}

/** Caller checks ACL on every request. This reuses one provider token per caller and stream until that token's exp, and does not store the ACL result. */
export async function streamPlayback(
  env: ProcessingEnv,
  uid: string,
  jobId: string,
  resource: string,
  principal: string,
): Promise<Response> {
  if (
    !/^[a-f0-9]{32}$/.test(uid) ||
    resource.includes("..") ||
    !/^[a-zA-Z0-9_.,/-]+\.(m3u8|ts|m4s|mp4|vtt)$/.test(resource) ||
    resource.length > 512
  )
    return new Response(null, { status: 400 });
  const api = streamApi(env);
  const nowSec = Math.floor(Date.now() / 1000);
  let token = takeGrant(principal, uid, nowSec);
  const fromCache = token !== null;
  if (!token) {
    const issued = await issuePlaybackToken(api, uid, nowSec);
    token = issued.token;
    rememberGrant(principal, uid, issued.token, issued.exp, nowSec);
  }
  let upstream = new URL(`https://videodelivery.net/${token}/${resource}`);
  let media = await fetch(upstream, { redirect: "error" });
  if ((media.status === 401 || media.status === 403) && fromCache) {
    await media.body?.cancel();
    playbackGrants.delete(grantKey(principal, uid));
    const again = Math.floor(Date.now() / 1000);
    const issued = await issuePlaybackToken(api, uid, again);
    token = issued.token;
    rememberGrant(principal, uid, issued.token, issued.exp, again);
    upstream = new URL(`https://videodelivery.net/${token}/${resource}`);
    media = await fetch(upstream, { redirect: "error" });
  }
  if (!media.ok) {
    if (media.status === 401 || media.status === 403) {
      await media.body?.cancel();
      playbackGrants.delete(grantKey(principal, uid));
    }
    return new Response(null, { status: media.status === 404 ? 404 : 502 });
  }
  const headers = {
    "Content-Type": media.headers.get("Content-Type") ?? "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!resource.endsWith(".m3u8")) return new Response(media.body, { headers });
  const rewrite = (raw: string) => {
    const url = new URL(raw, upstream);
    if (
      url.origin !== upstream.origin ||
      !url.pathname.startsWith(`/${token}/`) ||
      url.search ||
      url.hash
    )
      throw new Error("unexpected_stream_resource");
    return `/processing/stream/${encodeURIComponent(jobId)}/${url.pathname.slice(token.length + 2)}`;
  };
  const manifest = await media.text();
  if (manifest.length > 1_000_000) throw new Error("manifest_too_large");
  const rewritten = manifest
    .split("\n")
    .map((line) =>
      line.startsWith("#")
        ? line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${rewrite(uri)}"`)
        : line.trim()
          ? rewrite(line.trim())
          : line,
    )
    .join("\n");
  return new Response(rewritten, { headers });
}
