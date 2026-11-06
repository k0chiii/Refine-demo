import type { ByteRange, RangeRequest } from "./ports.ts";

/**
 * Range ヘッダー（RFC 9110 §14）の解決。単一の範囲だけを扱い、実体の大きさに収めた ByteRange にする。
 * - `null`: 範囲として扱わない（ヘッダー無し・bytes 以外の単位・複数範囲・書式不正）。呼び出し側は 200 で全体を返してよい
 * - `"unsatisfiable"`: 範囲が実体の外（416 とする）
 */
export function resolveRange(
  header: string | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") {
    // 末尾 n バイト
    const n = Number(b);
    if (n === 0 || size === 0) return "unsatisfiable";
    const length = Math.min(n, size);
    return { offset: size - length, length };
  }
  const start = Number(a);
  if (start >= size) return "unsatisfiable";
  const end = b === "" ? size - 1 : Math.min(Number(b), size - 1);
  // 終わりが始めより前の範囲指定は書式として成り立たないので無視する（RFC 9110: 無効な範囲指定は無視してよい）
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
}

/** If-None-Match が強い検証子 etag に当たるか（`*`・複数・弱い検証子の接頭辞 W/ を許す） */
export function matchesIfNoneMatch(header: string | undefined, etag: string | null): boolean {
  if (!header || !etag) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .includes(etag);
}

/**
 * Range ヘッダーを、実体の大きさを知らずに R2 へ渡せる形に読み替える（resolveRange と同じ書式の扱い）。
 * 大きさを知るための HEAD を省き、R2 の範囲読み 1 回で 206 を作るために使う。実体の外かどうかは R2 側（または返った大きさ）が決める。
 * - `null`: 範囲として扱わない（ヘッダー無し・bytes 以外の単位・複数範囲・書式不正・終わりが始めより前）
 */
export function parseRange(header: string | undefined): RangeRequest | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  if (a === "") return { suffix: Number(b) };
  const start = Number(a);
  if (b === "") return { offset: start };
  const end = Number(b);
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
}
