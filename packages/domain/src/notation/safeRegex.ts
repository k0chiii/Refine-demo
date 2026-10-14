/**
 * 利用者が登録する正規表現を安全に扱う。
 * - 長すぎる・壊れている・入れ子の量指定子（(a+)+ など、破滅的バックトラックの典型）を持つものは使わない
 * - 実行は行（段落）単位・一致数の上限付きで行い、長文で固まらないようにする
 */
export const REGEX_MAX_LENGTH = 300;

export type RegexCheck = { ok: true; regex: RegExp } | { ok: false; reason: string };

/** /source/flags か素の source を受け取り、g と u を付けた RegExp にする */
export function compileRulePattern(pattern: string): RegexCheck {
  const m = /^\/(.+)\/([a-z]*)$/is.exec(pattern);
  const source = m ? m[1]! : pattern;
  const flags = m ? m[2]! : "";
  if (source.length === 0) return { ok: false, reason: "空の正規表現" };
  if (source.length > REGEX_MAX_LENGTH)
    return { ok: false, reason: `長すぎる正規表現（${REGEX_MAX_LENGTH} 文字まで）` };
  if (/[^gimsuy]/.test(flags)) return { ok: false, reason: `使えないフラグ: ${flags}` };
  if (isLikelyCatastrophic(source))
    return { ok: false, reason: "処理が極端に遅くなるおそれのある正規表現（入れ子の繰り返し）" };
  try {
    const f = Array.from(new Set(`${flags}gu`.split(""))).join("");
    return { ok: true, regex: new RegExp(source, f) };
  } catch (e) {
    try {
      // u フラグで壊れる素朴な正規表現（例: \- の多用）は u 無しで試す
      const f = Array.from(new Set(`${flags}g`.split(""))).join("");
      return { ok: true, regex: new RegExp(source, f) };
    } catch {
      return {
        ok: false,
        reason: `正規表現として読めない: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

/** 量指定子を持つグループにさらに量指定子が付くもの（(a+)+、(\w*)*、(a|aa)+ のような交替の繰り返しの一部） */
export function isLikelyCatastrophic(source: string): boolean {
  // 文字クラスとエスケープを除いて構造だけを見る
  const s = source.replace(/\\./g, "x").replace(/\[[^\]]*\]/g, "x");
  const stack: Array<{ quantified: boolean; alternation: boolean }> = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(") stack.push({ quantified: false, alternation: false });
    else if (ch === "|" && stack.length) stack[stack.length - 1]!.alternation = true;
    else if ((ch === "+" || ch === "*" || ch === "{") && stack.length)
      stack[stack.length - 1]!.quantified = true;
    else if (ch === ")") {
      const g = stack.pop();
      const next = s[i + 1];
      const outerQuant = next === "+" || next === "*" || next === "{";
      if (g && outerQuant && g.quantified) return true;
      if (g && outerQuant && g.alternation && /\(\??:?([^()|]+)\|\1/.test(s)) return true;
      if (g?.quantified && stack.length) stack[stack.length - 1]!.quantified = true;
    }
  }
  return false;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
