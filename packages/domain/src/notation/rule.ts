import type { Instant } from "../shared/time.ts";
import type { UserId } from "../shared/ids.ts";

/**
 * 表記統一ルール（MF99 の表記統一スプレッドシートの後継。MF100 が正本）。
 * 単純な置換ではなく、カテゴリ（継承）・適用範囲・例外・言語・年度・厳格さ・版を持つ。
 */
export const ruleLanguages = ["ja", "en", "zh"] as const;
export type RuleLanguage = (typeof ruleLanguages)[number];
export const ruleLanguageLabels: Record<RuleLanguage, string> = {
  ja: "日本語",
  en: "英語",
  zh: "中国語",
};

/** required: 必須（誤りとして指摘） / recommended: 推奨 / review: 要確認（文法上の使い分けなど、断定しない） */
export const ruleStrictness = ["required", "recommended", "review"] as const;
export type RuleStrictness = (typeof ruleStrictness)[number];
export const ruleStrictnessLabels: Record<RuleStrictness, string> = {
  required: "必須",
  recommended: "推奨",
  review: "要確認",
};

export interface RuleCategory {
  /** 例: A1, A2, A3, B, C, D, E */
  code: string;
  name: string;
  description: string;
  /** 継承する一般カテゴリ（B → A1, A2, A3 など）。子のルールが優先 */
  parents: string[];
  /** ルール化できない運用の説明・管理メモ（スプレッドシートの説明行など） */
  policyNotes: string;
  order: number;
}

/**
 * 例外条件。一致がこの条件に当たれば指摘しない。
 * - phrase: 一致がこの語句の中にある（例: 「頂く」のルールで「頂上」）
 * - before / after: 一致の直前・直後がこの正規表現に合う（例: 本動詞の「頂く」= 直後が「ます」など）
 * - category: このカテゴリが選ばれている制作物では適用しない（用途別の例外）
 */
export interface ExceptionCondition {
  kind: "phrase" | "before" | "after" | "category";
  value: string;
  note?: string;
}

export interface NotationRule {
  /** 安定した識別子（例: A1-0001）。版をまたいで変わらない */
  ruleId: string;
  categoryCode: string;
  title: string;
  description: string;
  /** 統一表記（先頭が修正候補） */
  correct: string[];
  /** 誤表記（文字どおりに探す） */
  incorrect: string[];
  /** 正規表現（/…/flags または素の正規表現）。置換に $1 などを使える */
  patterns: string[];
  exceptions: ExceptionCondition[];
  language: RuleLanguage;
  /** 適用するカテゴリ（空なら所属カテゴリが選ばれていれば適用） */
  scopes: string[];
  /** 適用する年度（MF の回。空は全年度）。MF99 のルールを MF100 に無条件で適用しないため、取り込み時は年度を付ける */
  years: number[];
  priority: number;
  strictness: RuleStrictness;
  enabled: boolean;
  /** ルールの版（変更のたびに +1。校正結果に記録する） */
  revision: number;
  note?: string;
  /** 英語・中国語の表記（スプレッドシートの列） */
  translations?: { en?: string; zh?: string };
  createdBy: UserId;
  updatedBy: UserId;
  createdAt: Instant;
  updatedAt: Instant;
  publishedAt?: Instant;
}

/** 既定のカテゴリ（MF99 スプレッドシートの区分）。継承は管理者が変えられる初期値 */
export const defaultRuleCategories: RuleCategory[] = [
  {
    code: "A1",
    name: "固有名詞・文法",
    description: "団体名・企画名などの固有名詞と、文法上の表記",
    parents: [],
    policyNotes: "",
    order: 1,
  },
  {
    code: "A2",
    name: "日本語頻出単語",
    description: "よく使う語の表記（ひらがな・漢字の使い分けなど）",
    parents: [],
    policyNotes: "",
    order: 2,
  },
  {
    code: "A3",
    name: "地名",
    description: "キャンパス・建物・地名の表記",
    parents: [],
    policyNotes: "",
    order: 3,
  },
  {
    code: "B",
    name: "企画対応",
    description: "企画向けの文書。A の一般ルールも適用する",
    parents: ["A1", "A2", "A3"],
    policyNotes: "",
    order: 4,
  },
  {
    code: "C",
    name: "文書",
    description: "委員会の公式文書。独自の例外がある",
    parents: ["A1", "A2", "A3"],
    policyNotes: "",
    order: 5,
  },
  {
    code: "D",
    name: "委員会企画",
    description: "委員会が主催する企画の制作物",
    parents: ["A1", "A2", "A3"],
    policyNotes: "",
    order: 6,
  },
  {
    code: "E",
    name: "めい",
    description: "めい語（必須ルールと推奨ルールを区別する）",
    parents: [],
    policyNotes: "",
    order: 7,
  },
];

/** よく使う組み合わせ（制作物の登録で選ぶ。媒体・部署から自動では決めない） */
export const ruleSetPresets: Array<{ id: string; label: string; categories: string[] }> = [
  { id: "general", label: "一般", categories: ["A1", "A2", "A3"] },
  { id: "project", label: "企画対応", categories: ["B"] },
  { id: "document", label: "文書", categories: ["C"] },
  { id: "committee", label: "委員会企画", categories: ["D"] },
  { id: "mei", label: "めい語", categories: ["E"] },
];
