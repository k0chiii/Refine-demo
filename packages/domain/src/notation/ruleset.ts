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
  return sortEffective(out);
}

function sortEffective(rules: EffectiveRule[]): EffectiveRule[] {
  return rules.sort(
    (a, b) => a.depth - b.depth || b.priority - a.priority || a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * 版に記録するルールの組（どのルールのどの版で、どの深さで検査したか）。
 * 後からルールやカテゴリの継承を変えても過去の結果は変わらない。
 * depth は提出時の継承の深さ（競合の優先に使う）。この項目を足す前に記録した版には無い。
 */
export interface RuleSetSnapshot {
  categories: string[];
  year: number;
  rules: Array<{ ruleId: string; revision: number; depth?: number }>;
  hash: string;
}

export function snapshotOf(
  selected: readonly string[],
  year: number,
  rules: readonly EffectiveRule[],
): RuleSetSnapshot {
  const list = rules
    .map((r) => ({ ruleId: r.ruleId, revision: r.revision, depth: r.depth }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  return {
    categories: [...selected].sort(),
    year,
    rules: list,
    hash: fnv1a(JSON.stringify([selected, year, list])),
  };
}

/**
 * 版に記録したルールの組を復元する。
 * どのルールを当てるか（カテゴリの継承・適用範囲・年度・例外）は提出時に決まっているので、今のカテゴリでは選び直さない。
 * - rules: 記録した版の内容（ruleId と revision が一致するものだけを使う）
 * - legacyCategories: depth を記録していない古い版のときだけ、深さを今の継承から推定するのに使う
 */
export function restoreRuleSet(
  snapshot: RuleSetSnapshot,
  rules: readonly NotationRule[],
  legacyCategories: readonly RuleCategory[] = [],
): EffectiveRule[] {
  const byId = new Map(rules.map((r) => [`${r.ruleId}@${r.revision}`, r]));
  const legacy = snapshot.rules.some((r) => r.depth === undefined)
    ? expandCategories(legacyCategories, snapshot.categories)
    : new Map<string, number>();
  const out: EffectiveRule[] = [];
  for (const ref of snapshot.rules) {
    const r = byId.get(`${ref.ruleId}@${ref.revision}`);
    if (!r) continue;
    const depth =
      ref.depth ??
      legacy.get(r.categoryCode) ??
      (snapshot.categories.includes(r.categoryCode) ? 0 : 1);
    // 記録の時点で有効だったものなので、有効フラグはそのまま当てはまる
    out.push({ ...r, enabled: true, depth });
  }
  return sortEffective(out);
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
