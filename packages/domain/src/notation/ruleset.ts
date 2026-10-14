import type { NotationRule, RuleCategory } from "./rule.ts";

/**
 * 制作物に適用するルールの組（選んだカテゴリ＋継承した一般カテゴリ）。
 * depth は選んだカテゴリからの距離（0 = 選んだもの、1 = その親…）。同じ箇所で競合したら depth の小さい（より用途に近い）ルールを優先する。
 */
export interface EffectiveRule extends NotationRule {
  depth: number;
}

export function expandCategories(
  categories: readonly RuleCategory[],
  selected: readonly string[],
): Map<string, number> {
  const byCode = new Map(categories.map((c) => [c.code, c]));
  const depth = new Map<string, number>();
  const queue: Array<[string, number]> = selected.map((c) => [c, 0]);
  while (queue.length) {
    const [code, d] = queue.shift()!;
    if (depth.has(code) && depth.get(code)! <= d) continue;
    depth.set(code, d);
    for (const p of byCode.get(code)?.parents ?? []) if (d < 8) queue.push([p, d + 1]);
  }
  return depth;
}

export function resolveRuleSet(
  categories: readonly RuleCategory[],
  selected: readonly string[],
  rules: readonly NotationRule[],
  opts: { year: number },
): EffectiveRule[] {
  const depth = expandCategories(categories, selected);
  const out: EffectiveRule[] = [];
  for (const r of rules) {
    if (!r.enabled) continue;
    const d = depth.get(r.categoryCode);
    if (d === undefined) continue;
    if (r.years.length > 0 && !r.years.includes(opts.year)) continue;
    if (r.scopes.length > 0 && !r.scopes.some((s) => depth.has(s))) continue;
    // 用途別の例外: 選んだカテゴリ（またはその継承元）で外すと明示されていれば適用しない
    if (r.exceptions.some((e) => e.kind === "category" && depth.has(e.value))) continue;
    out.push({ ...r, depth: d });
  }
  return out.sort(
    (a, b) => a.depth - b.depth || b.priority - a.priority || a.ruleId.localeCompare(b.ruleId),
  );
}

/** 版に記録するルールの組（どのルールのどの版で検査したか）。後からルールを変えても過去の結果は変わらない */
export interface RuleSetSnapshot {
  categories: string[];
  year: number;
  rules: Array<{ ruleId: string; revision: number }>;
  hash: string;
}

export function snapshotOf(
  selected: readonly string[],
  year: number,
  rules: readonly EffectiveRule[],
): RuleSetSnapshot {
  const list = rules
    .map((r) => ({ ruleId: r.ruleId, revision: r.revision }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return {
    categories: [...selected].sort(),
    year,
    rules: list,
    hash: fnv1a(JSON.stringify([selected, year, list])),
  };
}

/** 依存のない短いハッシュ（重複防止の指紋などに使う。暗号用途ではない） */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
