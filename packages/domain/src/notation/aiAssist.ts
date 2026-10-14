import type { Confidentiality } from "../work/Work.ts";
import type { Finding } from "./proofreader.ts";
import { fnv1a } from "./ruleset.ts";

/**
 * 任意の AI 校正（外部の AI に文章を送る）。
 * - 利用者が明示的に押したときだけ送る。送る前に送り先を画面で知らせる
 * - API キーはサーバーだけが持つ。キーが無ければ機能ごと無効（画面にも出さない理由を返す）
 * - 機密区分で使えるかを決める（既定: 非公開・取扱注意は送らない）。制度上の判断は設定で変えられるポリシー
 * - 結果は候補だけ。ルールやコメントを AI が自動で作ったり変えたりしない
 */
export interface AiPolicy {
  /** API キーがあり、運用で有効にしている */
  enabled: boolean;
  /** 非公開・取扱注意の制作物でも送ってよいか（既定 false。承認されたら設定で true） */
  allowRestricted: boolean;
  /** 1 回に送る最大の文字数 */
  maxChars: number;
}

export const defaultAiPolicy: AiPolicy = {
  enabled: false,
  allowRestricted: false,
  maxChars: 20_000,
};

/** 使えない理由（使えるなら null） */
export function aiBlockReason(
  policy: AiPolicy,
  work: { confidentiality: Confidentiality },
): string | null {
  if (!policy.enabled) return "AI 校正は設定されていません（API キー未設定または無効）";
  if (work.confidentiality === "restricted" && !policy.allowRestricted)
    return "非公開・取扱注意の制作物では AI 校正を使えません（外部に送らないため）";
  return null;
}

export interface AiCandidate {
  original: string;
  suggestion: string;
  reason: string;
  ruleId?: string;
}

/**
 * AI の候補を本文に当てはめる（サーバーで確かめる）。
 * 本文に無い文字・修正前後が同じもの・長すぎるものは捨てる。位置は本文の中の出現順で割り当てる。
 */
export function placeAiCandidates(
  text: string,
  candidates: readonly AiCandidate[],
  knownRules: ReadonlyMap<string, number> = new Map(),
): Finding[] {
  const out: Finding[] = [];
  const used: Array<[number, number]> = [];
  for (const c of candidates.slice(0, 100)) {
    const original = String(c.original ?? "").slice(0, 200);
    const suggestion = String(c.suggestion ?? "").slice(0, 200);
    if (!original || original === suggestion) continue;
    let at = text.indexOf(original);
    while (at >= 0 && used.some(([s, e]) => at < e && s < at + original.length))
      at = text.indexOf(original, at + 1);
    if (at < 0) continue;
    used.push([at, at + original.length]);
    const ruleId = c.ruleId && knownRules.has(c.ruleId) ? c.ruleId : "";
    out.push({
      ruleId: ruleId || "AI",
      ruleRevision: ruleId ? knownRules.get(ruleId)! : 0,
      categoryCode: "",
      title: "AI の候補",
      start: at,
      end: at + original.length,
      original,
      suggestion,
      reason: String(c.reason ?? "").slice(0, 500),
      exceptionNote: "",
      strictness: "review",
      detector: "ai",
      confidence: "low",
      needsReview: true,
      fingerprint: fnv1a(`ai|${at}|${original}|${suggestion}`),
    });
    if (out.length >= 50) break;
  }
  return out.sort((a, b) => a.start - b.start);
}
