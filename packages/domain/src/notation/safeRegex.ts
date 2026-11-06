/**
 * 利用者が登録する正規表現を安全に扱う。
 * - 長すぎる・壊れている・入れ子の量指定子（(a+)+ など、破滅的バックトラックの典型）を持つものは使わない
 * - 実行は行（段落）単位・一致数の上限付きで行い、長文で固まらないようにする
 */
export const REGEX_MAX_LENGTH = 300;

export type RegexCheck = { ok: true; regex: RegExp } | { ok: false; reason: string };

export interface CompileOptions {
  /**
   * 空文字に一致できる正規表現（a*、(?:)、x? など）を受け入れるか。既定は拒否。
   * ルールの誤表記の正規表現は「何かの文字に一致する」ものだけが意味を持つので拒否する。
   * 例外条件（直前・直後の文脈の判定）は内部で組み立てる式なので受け入れる。
   */
  allowEmptyMatch?: boolean;
}

/**
 * /source/flags か素の source を受け取り、g と u を付けた RegExp にする。
 * 空文字に一致できるもの（a*・(?:) など）は、登録の時点で拒否する（実行時も空一致は読み飛ばす）。
 * (?=…) のように空文字だけでは一致しないが、文中で空一致するものは登録時に見分けられないので、実行時に読み飛ばす。
 */
export function compileRulePattern(pattern: string, opts: CompileOptions = {}): RegexCheck {
  const m = /^\/(.+)\/([a-z]*)$/is.exec(pattern);
  const source = m ? m[1]! : pattern;
  const flags = m ? m[2]! : "";
  if (source.length === 0) return { ok: false, reason: "空の正規表現" };
  if (source.length > REGEX_MAX_LENGTH)
    return { ok: false, reason: `長すぎる正規表現（${REGEX_MAX_LENGTH} 文字まで）` };
  if (/[^gimsuy]/.test(flags)) return { ok: false, reason: `使えないフラグ: ${flags}` };
  if (isLikelyCatastrophic(source))
    return { ok: false, reason: "処理が極端に遅くなるおそれのある正規表現（入れ子の繰り返し）" };
  let regex: RegExp;
  try {
    const f = Array.from(new Set(`${flags}gu`.split(""))).join("");
    regex = new RegExp(source, f);
  } catch (e) {
    try {
      // u フラグで壊れる素朴な正規表現（例: \- の多用）は u 無しで試す
      const f = Array.from(new Set(`${flags}g`.split(""))).join("");
      regex = new RegExp(source, f);
    } catch {
      return {
        ok: false,
        reason: `正規表現として読めない: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  if (!opts.allowEmptyMatch && matchesEmpty(regex))
    return { ok: false, reason: "空の文字列に一致する正規表現（a* や (?:) など）は使えません" };
  return { ok: true, regex };
}

/** 空の文字列に一致できるか（登録の時点で見分けられる範囲） */
function matchesEmpty(regex: RegExp): boolean {
  const probe = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ""));
  return probe.test("");
}

/**
 * 空一致の後に lastIndex を 1 コードポイント進める。
 * u フラグの正規表現でサロゲートペアの途中を指すと、次の exec が同じ位置（ペアの先頭）から一致し直して止まらなくなる。
 */
export function advancePastEmptyMatch(re: RegExp, text: string): void {
  const at = re.lastIndex;
  const cp = text.codePointAt(at);
  re.lastIndex = at + (cp !== undefined && cp > 0xffff ? 2 : 1);
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
