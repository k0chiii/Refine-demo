import type { Anchor } from "../comment/Anchor.ts";

/**
 * Figma の URL の解釈と、そこから作るリンク（docs/FIGMA_WEB_PROOFING.md §2.1・§6）。
 * - `figma.com/design/:key/:name?node-id=1-2`（新）、`/file/:key/...`（旧）、`/proto/:key`（プロトタイプ）、
 *   `/board/:key`（FigJam）、`/slides/:key`。ブランチの URL `/design/:key/branch/:branchKey/:name` は branchKey が実体
 * - URL の node-id は「1-2」、REST API・埋め込みのノード ID は「1:2」。保存は「1:2」に揃える
 * - REST API（画像の書き出し）は利用者決定 2026-10-17「API が使えるならまずはそっちで試す」で先に使う。
 *   トークンはサーバー（Hono）の秘密。埋め込み（iframe）は文脈を見る・取り込めないときの代わり
 */
export type FigmaUrlKind = "design" | "proto" | "board" | "slides";

export interface FigmaRef {
  kind: FigmaUrlKind;
  fileKey: string;
  /** URL のファイル名の部分（表示名。無いこともある） */
  fileName?: string;
  /** ノード ID（「1:2」の形。無ければファイル全体） */
  nodeId?: string;
}

const FILE_KEY = /^[A-Za-z0-9]{10,128}$/;

/** Figma の URL を解釈する。Figma でない・鍵が無い URL は null（domain は DOM を使わないので URL は自前で分ける） */
export function parseFigmaUrl(raw: string): FigmaRef | null {
  const m = /^https:\/\/(?:www\.|embed\.)?figma\.com(\/[^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(
    raw.trim(),
  );
  if (!m) return null;
  const parts = m[1]!.split("/").filter(Boolean);
  const head = parts[0];
  let kind: FigmaUrlKind;
  if (head === "design" || head === "file") kind = "design";
  else if (head === "proto") kind = "proto";
  else if (head === "board") kind = "board";
  else if (head === "slides") kind = "slides";
  else return null;
  let fileKey = parts[1];
  let nameIndex = 2;
  if (parts[2] === "branch" && parts[3]) {
    fileKey = parts[3];
    nameIndex = 4;
  }
  if (!fileKey || !FILE_KEY.test(fileKey)) return null;
  const query = queryParams(m[2] ?? "");
  const nodeRaw = query["node-id"] ?? query["node_id"];
  const nodeId = nodeRaw ? normalizeFigmaNodeId(nodeRaw) : null;
  const fileName = parts[nameIndex] ? safeDecode(parts[nameIndex]!) : undefined;
  return {
    kind,
    fileKey,
    ...(fileName ? { fileName } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

function queryParams(q: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of q.split("&")) {
    if (!pair) continue;
    const i = pair.indexOf("=");
    const k = safeDecode(i < 0 ? pair : pair.slice(0, i));
    if (!(k in out)) out[k] = i < 0 ? "" : safeDecode(pair.slice(i + 1));
  }
  return out;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** 「1-2」「1:2」「1%3A2」→「1:2」。形が違えば null */
export function normalizeFigmaNodeId(raw: string): string | null {
  let s = raw.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // そのまま
  }
  const m = /^(\d+)[:-](\d+)$/.exec(s);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Figma のそのノードを開くリンク（API 不要。FG-04） */
export function figmaDeepLink(ref: FigmaRef): string {
  const path = ref.kind === "design" ? "design" : ref.kind;
  const name = encodeURIComponent(ref.fileName ?? "Untitled");
  const node = ref.nodeId ? `?node-id=${ref.nodeId.replace(":", "-")}` : "";
  return `https://www.figma.com/${path}/${ref.fileKey}/${name}${node}`;
}

/**
 * 埋め込み表示（Embed Kit 2.0: `www` → `embed`、`embed-host` 必須）。
 * 解釈できない URL は 1.0 の形 `https://www.figma.com/embed?embed_host=…&url=…` に逃がす
 */
export function figmaEmbedUrl(raw: string, host = "mf100"): string {
  const ref = parseFigmaUrl(raw);
  if (!ref)
    return `https://www.figma.com/embed?embed_host=${encodeURIComponent(host)}&url=${encodeURIComponent(raw.trim())}`;
  const path = ref.kind === "design" ? "design" : ref.kind;
  const name = encodeURIComponent(ref.fileName ?? "Untitled");
  const q = [
    ...(ref.nodeId ? [`node-id=${ref.nodeId.replace(":", "-")}`] : []),
    `embed-host=${encodeURIComponent(host)}`,
  ].join("&");
  return `https://embed.figma.com/${path}/${ref.fileKey}/${name}?${q}`;
}

/** 貼られた文（1 行 1 URL）から Figma のフレームの URL を集める（重複は除く。ノード無しも残す） */
export function collectFigmaUrls(text: string): Array<{ url: string; ref: FigmaRef }> {
  const out: Array<{ url: string; ref: FigmaRef }> = [];
  const seen = new Set<string>();
  for (const line of text.split(/\s+/)) {
    const ref = parseFigmaUrl(line);
    if (!ref) continue;
    const key = `${ref.fileKey}#${ref.nodeId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: line.trim(), ref });
  }
  return out;
}

/** フレーム単位のコメント（figma_node）の場所の表示: 「フレーム: ホーム」 */
export function formatFigmaPlace(a: Extract<Anchor, { type: "figma_node" }>): string {
  return `フレーム: ${a.nodeName?.trim() || a.nodeId}`;
}

/**
 * Figma 連携のポリシー値（承認待ちの項目はコードで確定しない。CLAUDE.md）。
 * - enabled: REST API での取り込み。サーバーに FIGMA_ACCESS_TOKEN があるときだけ（利用者決定 2026-10-17: まず API で試す）
 * - writeBack: Figma へのコメント書き戻し（外部への実データ送信。承認まで false）
 * - allowRestricted: 取扱注意の制作物でも Figma へ取りに行くか（AI 校正と同じく既定 false）
 * - renderScale: 書き出しの倍率（`GET /v1/images` の scale）
 */
export interface FigmaPolicy {
  enabled: boolean;
  writeBack: boolean;
  allowRestricted: boolean;
  renderScale: 1 | 2;
}

export const defaultFigmaPolicy: FigmaPolicy = {
  enabled: false,
  writeBack: false,
  allowRestricted: false,
  renderScale: 2,
};
