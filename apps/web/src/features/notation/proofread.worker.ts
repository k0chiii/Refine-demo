/// <reference lib="webworker" />
import { proofread, type EffectiveRule, type ProofreadOptions } from "@mf100/domain";

/**
 * 表記の検査をメインスレッドの外で行う（長文・多数のルールでも入力が固まらない）。
 * ルールは変わったときだけ受け取り、検査のたびに文章だけを受け取る。外部には何も送らない。
 */
let rules: EffectiveRule[] = [];
self.onmessage = (e: MessageEvent) => {
  const m = e.data as
    | { type: "rules"; rules: EffectiveRule[] }
    | { type: "check"; id: number; text: string; opts?: ProofreadOptions };
  if (m.type === "rules") {
    rules = m.rules;
    return;
  }
  const result = proofread(m.text, rules, { timeBudgetMs: 3000, ...m.opts });
  (self as unknown as Worker).postMessage({ id: m.id, ...result });
};
