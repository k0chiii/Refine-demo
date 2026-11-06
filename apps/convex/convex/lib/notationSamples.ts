import type { RuleDraft } from "@mf100/domain";

/**
 * 表記統一のサンプルルール（notation2 の初期データ＋α。MF100 の正本ではない）。
 * デモ・開発の seed と、本番への初期投入（notationSeed:importSamples）で同じものを使う
 */
const SAMPLE_RULES = [
  {
    ruleId: "A1-0001",
    categoryCode: "A1",
    title: "五月祭",
    correct: ["五月祭"],
    patterns: ["[5５]月祭"],
    description: "固有名詞は漢数字で表記します。",
  },
  {
    ruleId: "A1-0002",
    categoryCode: "A1",
    title: "昨年の五月祭",
    correct: ["昨年の五月祭"],
    patterns: ["(去年|昨年度|前回)の五月祭"],
    priority: 1,
    description: "前回の開催は「昨年の五月祭」と表記します。",
  },
  {
    ruleId: "A2-0001",
    categoryCode: "A2",
    title: "いただく（補助用言）",
    correct: ["いただき"],
    incorrect: ["頂き"],
    description: "補助用言はひらがなで表記します。",
    exceptions: [
      {
        kind: "after" as const,
        value: "物|もの",
        note: "本動詞として使われる場合（例: 頂き物）は漢字",
      },
    ],
    strictness: "review" as const,
  },
  {
    ruleId: "A2-0002",
    categoryCode: "A2",
    title: "お問い合わせ",
    correct: ["お問い合わせ"],
    incorrect: ["お問合せ", "お問合わせ", "お問い合せ"],
    description: "送り仮名を省略しません。",
  },
  {
    ruleId: "A2-0003",
    categoryCode: "A2",
    title: "ください",
    correct: ["ください"],
    incorrect: ["下さい"],
    description: "補助動詞はひらがなで表記します。",
  },
  {
    ruleId: "A3-0001",
    categoryCode: "A3",
    title: "本郷キャンパス",
    correct: ["本郷キャンパス"],
    patterns: ["本郷(?!キャンパス|通り|三丁目)"],
    strictness: "recommended" as const,
    description: "会場は「本郷キャンパス」と表記します。",
  },
  {
    ruleId: "B-0001",
    categoryCode: "B",
    title: "企画",
    correct: ["企画"],
    incorrect: ["出し物"],
    strictness: "recommended" as const,
    description: "企画対応の文書では「企画」に統一します。",
  },
  {
    ruleId: "A2-9901",
    categoryCode: "A2",
    title: "（MF99）Web サイト",
    correct: ["Webサイト"],
    incorrect: ["ウェブサイト"],
    years: [99],
    description: "MF99 のルール。MF100 には適用しない例。",
  },
];

/** 既定値を補った取り込み用の形 */
export const SAMPLE_RULE_DRAFTS: RuleDraft[] = SAMPLE_RULES.map((r) => ({
  incorrect: [],
  patterns: [],
  exceptions: [],
  language: "ja",
  scopes: [],
  years: [100],
  priority: 0,
  strictness: "required",
  enabled: true,
  ...r,
}));
