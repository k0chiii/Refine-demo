import { FigmaApiError, type FigmaClient, type FigmaNodeInfo } from "../ports.ts";

const API = "https://api.figma.com/v1";

/**
 * Figma REST API（fetch）。トークンは `X-Figma-Token`（個人アクセストークン。OAuth に替えるときは Authorization: Bearer）。
 * 応答の形は developers.figma.com/docs/rest-api の file-endpoints / images を参照。ログにトークンも URL も出さない。
 */
export function createFigmaClient(token: string, fetchImpl: typeof fetch = fetch): FigmaClient {
  const failure = (res: Response) => {
    const ra = Number(res.headers.get("Retry-After"));
    return new FigmaApiError(res.status, Number.isFinite(ra) && ra > 0 ? ra : null);
  };
  const call = async <T>(path: string): Promise<T> => {
    const res = await fetchImpl(`${API}${path}`, { headers: { "X-Figma-Token": token } });
    if (!res.ok) throw failure(res);
    return (await res.json()) as T;
  };
  return {
    async getNodes(fileKey, nodeIds) {
      const data = await call<{
        version?: string;
        lastModified?: string;
        nodes?: Record<
          string,
          {
            document?: {
              name?: string;
              absoluteBoundingBox?: { width?: number; height?: number } | null;
            };
          } | null
        >;
      }>(
        `/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeIds.join(","))}&depth=1`,
      );
      const nodes = new Map<string, FigmaNodeInfo>();
      for (const [id, n] of Object.entries(data.nodes ?? {})) {
        const doc = n?.document;
        if (!doc) continue;
        const box = doc.absoluteBoundingBox;
        nodes.set(id, {
          name: typeof doc.name === "string" && doc.name ? doc.name : id,
          box:
            box && typeof box.width === "number" && typeof box.height === "number"
              ? { width: box.width, height: box.height }
              : null,
        });
      }
      return {
        version: typeof data.version === "string" ? data.version : null,
        lastModified: typeof data.lastModified === "string" ? data.lastModified : null,
        nodes,
      };
    },
    async renderImages(fileKey, nodeIds, scale) {
      const data = await call<{ err?: string | null; images?: Record<string, string | null> }>(
        `/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeIds.join(","))}&scale=${scale}&format=png&use_absolute_bounds=true`,
      );
      const out = new Map<string, string | null>();
      for (const id of nodeIds) out.set(id, data.images?.[id] ?? null);
      return out;
    },
    async download(url) {
      // 画像の一時 URL は Figma の CDN（S3）。トークンは付けない
      const res = await fetchImpl(url);
      if (!res.ok) throw failure(res);
      return res.arrayBuffer();
    },
  };
}
