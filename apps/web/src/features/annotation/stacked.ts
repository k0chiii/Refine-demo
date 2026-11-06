/**
 * 同じ箇所に複数のコメントが重なっているとき、押すたびに次のコメントへ移る。
 * いま選んでいるコメントがその箇所に無ければ先頭を選ぶ。
 */
export function nextStacked(ids: readonly string[], active: string | null): string | null {
  if (ids.length === 0) return null;
  const i = active ? ids.indexOf(active) : -1;
  return ids[(i + 1) % ids.length]!;
}
