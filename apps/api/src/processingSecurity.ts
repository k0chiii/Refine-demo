/** Exact public host allowlist is applied to the main navigation, redirects and every subresource. */
export function publicSnapshotUrl(raw: string, allowedHosts: string[]): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    raw.length > 2048 ||
    !allowedHosts.includes(host) ||
    !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ||
    /^[0-9.]+$/.test(host) ||
    /(^|\.)(localhost|local|internal|invalid|test)$/.test(host)
  )
    throw new Error("snapshot_url_not_allowed");
  return url;
}
export function outputKey(jobId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(jobId)) throw new Error("invalid_job_id");
  return `derived/${jobId}/result`;
}
