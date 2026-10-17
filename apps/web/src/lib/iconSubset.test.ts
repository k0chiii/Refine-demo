import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import subset from "../assets/material-symbols-subset.json";

/**
 * アイコンのフォントは使うアイコンだけに絞っている（scripts/subset-icons.py）。
 * 絞った後にアイコンを足すと、フォントに無いアイコンは名前の文字がそのまま出てしまうので、ここで検出する。
 * 見るのは `<M3eIcon name=...>` と `icon: "..."` / `icon="..."` の文字列（条件式の中も）。
 */
const SRC = join(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "assets" ? [] : files(p);
    return /\.tsx?$/.test(n) && !n.includes(".test.") && n !== "routeTree.gen.ts" ? [p] : [];
  });
}
/** 式の中の文字列（`a === "x" ? ...` の比較相手は除く） */
const literals = (s: string) =>
  [...s.replace(/[!=]==\s*"[^"]*"/g, "").matchAll(/"([a-z0-9][a-z0-9_]+)"/g)].map((m) => m[1]!);

describe("アイコンのフォント（使うアイコンだけに絞ったもの）", () => {
  it("コードで使うアイコンがすべてフォントに入っている", () => {
    const have = new Set<string>(subset);
    const missing = new Set<string>();
    for (const f of files(SRC)) {
      const text = readFileSync(f, "utf8");
      const uses = [
        ...[...text.matchAll(/<M3eIcon\b[^>]*?\bname=("[^"]*"|\{[^}]*\})/g)].map((m) => m[1]!),
        ...[...text.matchAll(/\bicon(?::|=)\s*("[^"]*"|\{[^}]*\})/g)].map((m) => m[1]!),
      ];
      for (const u of uses) for (const name of literals(u)) if (!have.has(name)) missing.add(name);
    }
    expect([...missing], "pnpm --filter @mf100/web icons で作り直してください").toEqual([]);
  });
});
