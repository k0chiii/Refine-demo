import type { RuleStrictness } from "./rule.ts";
import type { EffectiveRule } from "./ruleset.ts";
import { advancePastEmptyMatch, compileRulePattern, escapeRegex } from "./safeRegex.ts";
import { fnv1a } from "./ruleset.ts";

/**
 * 表記統一の検査エンジン（notation2 の proofreader を元に MF100 向けに拡張。AI は使わない）。
 * - 辞書（誤表記の文字列）と正規表現で探し、例外条件・優先順位・重なりを処理する
 * - 行（段落）単位で実行し、一致数の上限と時間の上限を持つ（長文・危険な正規表現で固まらない）
 * - 判断が難しいもの（要確認ルール、OCR 由来で信頼度が低いもの）は誤りと断定しない
 */

/** 検出方式。rule: 辞書・正規表現 / morphology: 形態素解析 / ocr: OCR の文字に対する rule / ai: LLM */
export type Detector = "rule" | "morphology" | "ocr" | "ai";
export type FindingConfidence = "high" | "medium" | "low";

export interface Finding {
  ruleId: string;
  ruleRevision: number;
  categoryCode: string;
  title: string;
  /** 入力テキスト内の [start, end) */
  start: number;
  end: number;
  original: string;
  suggestion: string;
  /** 理由（ルールの説明） */
  reason: string;
  /** 例外の可能性（ルールの例外メモ） */
  exceptionNote: string;
  strictness: RuleStrictness;
  detector: Detector;
  confidence: FindingConfidence;
  /** 誤りと断定せず「要確認」として出す */
  needsReview: boolean;
  /** 同じ箇所・同じルールを識別する指紋（位置情報と組み合わせて重複防止に使う） */
  fingerprint: string;
}

export interface ProofreadOptions {
  /** OCR で得た文字か（信頼度を一段下げる） */
  source?: "text" | "ocr";
  /** OCR の信頼度（0..1）。0.8 未満なら要確認にする */
  ocrConfidence?: number;
  maxFindings?: number;
  /** 1 回の検査の上限時間（ms）。超えたら残りを打ち切り truncated を立てる */
  timeBudgetMs?: number;
  /** 時刻の取得（テスト用に差し替え可能） */
  now?: () => number;
}

export interface ProofreadResult {
  findings: Finding[];
  /** 使えなかったルール（壊れた・危険な正規表現） */
  skipped: Array<{ ruleId: string; reason: string }>;
  truncated: boolean;
}

interface Compiled {
  rule: EffectiveRule;
  regexes: Array<{ re: RegExp; isPattern: boolean }>;
}

const LINE_MAX = 5000;
const PER_RULE_MAX = 500;

function compile(rules: readonly EffectiveRule[], skipped: ProofreadResult["skipped"]): Compiled[] {
  const out: Compiled[] = [];
  for (const rule of rules) {
    const regexes: Compiled["regexes"] = [];
    const literals = rule.incorrect.filter((s) => s.trim() !== "");
    if (literals.length > 0)
      regexes.push({
        re: new RegExp(
          literals
            .sort((a, b) => b.length - a.length)
            .map(escapeRegex)
            .join("|"),
          "gu",
        ),
        isPattern: false,
      });
    for (const p of rule.patterns) {
      if (p.trim() === "") continue;
      const c = compileRulePattern(p);
      if (c.ok) regexes.push({ re: c.regex, isPattern: true });
      else skipped.push({ ruleId: rule.ruleId, reason: c.reason });
    }
    if (regexes.length) out.push({ rule, regexes });
  }
  return out;
}

function isException(rule: EffectiveRule, line: string, s: number, e: number): boolean {
  for (const ex of rule.exceptions) {
    if (ex.kind === "phrase" && ex.value) {
      let at = line.indexOf(ex.value);
      while (at >= 0) {
        if (at <= s && at + ex.value.length >= e) return true;
        at = line.indexOf(ex.value, at + 1);
      }
    } else if (ex.kind === "before" || ex.kind === "after") {
      const c = compileRulePattern(ex.kind === "before" ? `(?:${ex.value})$` : `^(?:${ex.value})`, {
        allowEmptyMatch: true,
      });
      if (!c.ok) continue;
      c.regex.lastIndex = 0;
      const ctx = ex.kind === "before" ? line.slice(Math.max(0, s - 40), s) : line.slice(e, e + 40);
      if (c.regex.test(ctx)) return true;
    }
  }
  return false;
}

const strictRank: Record<RuleStrictness, number> = { required: 0, recommended: 1, review: 2 };

export function proofread(
  text: string,
  rules: readonly EffectiveRule[],
  opts: ProofreadOptions = {},
): ProofreadResult {
  const skipped: ProofreadResult["skipped"] = [];
  const compiled = compile(rules, skipped);
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const budget = opts.timeBudgetMs ?? 1500;
  const maxFindings = opts.maxFindings ?? 2000;
  const raw: Array<Finding & { depth: number; priority: number }> = [];
  let truncated = false;
  // 段落（改行）ごと。極端に長い行は分けて調べる（行の途中の一致は位置を補正）
  const segments: Array<{ text: string; offset: number }> = [];
  let off = 0;
  for (const line of text.split("\n")) {
    for (let i = 0; i < line.length || i === 0; i += LINE_MAX)
      segments.push({ text: line.slice(i, i + LINE_MAX), offset: off + i });
    off += line.length + 1;
  }
  outer: for (const { rule, regexes } of compiled) {
    let count = 0;
    for (const { re, isPattern } of regexes) {
      for (const seg of segments) {
        if (now() - started > budget || raw.length >= maxFindings) {
          truncated = true;
          break outer;
        }
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(seg.text)) !== null) {
          // 一致のたびに時間と件数の上限を確かめる（空一致が続いても、この while の中で止められるように）
          if (now() - started > budget || raw.length >= maxFindings) {
            truncated = true;
            break outer;
          }
          if (m[0].length === 0) {
            // 空一致（(?=…)・\b など登録時に見分けられないもの）は指摘にせず、1 コードポイント進める
            advancePastEmptyMatch(re, seg.text);
            continue;
          }
          const s = m.index;
          const e = s + m[0].length;
          if (++count > PER_RULE_MAX) break;
          // 正しい表記そのものに一致したものは指摘しない（例: 誤表記の正規表現が正しい形も含む場合）
          if (rule.correct.includes(m[0])) continue;
          if (isException(rule, seg.text, s, e)) continue;
          let suggestion = rule.correct[0] ?? "";
          if (isPattern && suggestion.includes("$")) {
            const single = new RegExp(re.source, re.flags.replace("g", ""));
            suggestion = m[0].replace(single, suggestion);
          }
          const ocr = opts.source === "ocr";
          const lowOcr = ocr && (opts.ocrConfidence ?? 1) < 0.8;
          const base: FindingConfidence =
            rule.strictness === "required"
              ? "high"
              : rule.strictness === "recommended"
                ? "medium"
                : "low";
          const confidence: FindingConfidence = ocr ? (base === "high" ? "medium" : "low") : base;
          const start = seg.offset + s;
          raw.push({
            ruleId: rule.ruleId,
            ruleRevision: rule.revision,
            categoryCode: rule.categoryCode,
            title: rule.title,
            start,
            end: seg.offset + e,
            original: m[0],
            suggestion,
            reason: rule.description,
            exceptionNote: rule.exceptions
              .filter((x) => x.kind !== "category")
              .map((x) => x.note ?? x.value)
              .filter(Boolean)
              .join(" / "),
            strictness: rule.strictness,
            detector: ocr ? "ocr" : "rule",
            confidence,
            needsReview: rule.strictness === "review" || lowOcr,
            fingerprint: fnv1a(`${rule.ruleId}|${start}|${m[0]}`),
            depth: rule.depth,
            priority: rule.priority,
          });
        }
      }
    }
  }
  // 重なりの解決: より用途に近い（depth 小）→ 優先度が高い → 厳格 → 長い一致 の順に残す
  raw.sort(
    (a, b) =>
      a.depth - b.depth ||
      b.priority - a.priority ||
      strictRank[a.strictness] - strictRank[b.strictness] ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const kept: typeof raw = [];
  for (const f of raw) if (!kept.some((k) => k.start < f.end && f.start < k.end)) kept.push(f);
  const findings = kept
    .sort((a, b) => a.start - b.start)
    .map(({ depth: _d, priority: _p, ...f }) => f);
  return { findings, skipped, truncated };
}

/** ワンクリック修正: 指摘を適用した文字列（後ろから置き換えて位置がずれないようにする） */
export function applyFindings(
  text: string,
  findings: readonly Pick<Finding, "start" | "end" | "original" | "suggestion">[],
): string {
  let out = text;
  for (const f of [...findings].sort((a, b) => b.start - a.start)) {
    if (out.slice(f.start, f.end) !== f.original) continue; // 編集で位置がずれたものは適用しない
    out = out.slice(0, f.start) + f.suggestion + out.slice(f.end);
  }
  return out;
}
