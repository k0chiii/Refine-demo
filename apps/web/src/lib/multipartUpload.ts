type Part = { partNumber: number; etag: string };
type Manifest = {
  sha256: string;
  attemptId: string;
  uploadId: string;
  partSize: number;
  parts: Part[];
};
/** Session storage contains no token or bytes. A fresh application JWT authorizes every resumed operation. */
export async function multipartUpload(options: {
  apiUrl: string;
  token: string;
  itemId: string;
  body: Blob;
  sha256: string;
  onProgress?: (fraction: number) => void;
}): Promise<{ itemId: string; size: number; status: string; failureMessage: string | null }> {
  const { apiUrl, token, itemId, body, sha256 } = options;
  const key = `refine-multipart:${itemId}`;
  const load = (): Manifest | null => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  };
  const persist = (manifest: Manifest) => {
    try {
      sessionStorage.setItem(key, JSON.stringify(manifest));
    } catch {
      /* Upload still works if storage is unavailable. */
    }
  };
  const request = async (path: string, method: string, manifest?: Manifest, data?: BodyInit) => {
    const response = await fetch(`${apiUrl}/uploads/multipart/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(manifest
          ? { "X-Multipart-Upload-ID": manifest.uploadId }
          : { "X-Content-SHA256": sha256 }),
        ...(typeof data === "string" ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: data } : {}),
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* optional persistence */
        }
      }
      throw new Error(
        "ファイルをアップロードできませんでした。再送すると送信済みの部分から再開します。",
      );
    }
    return response.json();
  };
  let manifest = load();
  if (!manifest || manifest.sha256 !== sha256) {
    const started = (await request(`start/${encodeURIComponent(itemId)}`, "POST")) as Omit<
      Manifest,
      "sha256" | "parts"
    >;
    manifest = { ...started, sha256, parts: [] };
    persist(manifest);
  }
  if (
    !Number.isInteger(manifest.partSize) ||
    manifest.partSize < 5 * 1024 * 1024 ||
    manifest.partSize > 16 * 1024 * 1024
  )
    throw new Error("invalid_multipart_response");
  const parts = Math.ceil(body.size / manifest.partSize);
  for (let n = 1; n <= parts; n++) {
    if (!manifest.parts.some((p) => p.partNumber === n)) {
      const part = (await request(
        `part/${encodeURIComponent(manifest.attemptId)}/${n}`,
        "PUT",
        manifest,
        body.slice((n - 1) * manifest.partSize, n * manifest.partSize),
      )) as Part;
      manifest.parts.push(part);
      persist(manifest);
    }
    options.onProgress?.((Math.min(n * manifest.partSize, body.size) / body.size) * 0.95);
  }
  const result = (await request(
    `complete/${encodeURIComponent(manifest.attemptId)}`,
    "POST",
    manifest,
    JSON.stringify({ parts: manifest.parts.sort((a, b) => a.partNumber - b.partNumber) }),
  )) as { status: string; failureMessage: string | null };
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* optional persistence */
  }
  options.onProgress?.(1);
  return { ...result, itemId, size: body.size };
}
