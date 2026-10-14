import type { Instant } from "../shared/time.ts";
import type { UserId } from "../shared/ids.ts";
import type { ExceptionCondition } from "./rule.ts";
import { fnv1a } from "./ruleset.ts";

/**
 * ルールの変更提案（一般ユーザー → カテゴリ管理者）。承認されるまでルールには反映されない。
 * - new: 新しいルール / change: 既存ルールの変更 / report: 誤表記の報告（ルール案が未完成でもよい）
 * - 同じ内容の未処理の提案があれば新しく作らず、賛同者として加える（重複防止）
 * - AI による自動のルール追加・変更はしない（提案は必ず人が作り、人が承認する）
 */
export const proposalKinds = ["new", "change", "report"] as const;
export type ProposalKind = (typeof proposalKinds)[number];
export const proposalStatuses = ["open", "approved", "rejected"] as const;
export type ProposalStatus = (typeof proposalStatuses)[number];

export interface ProposalContext {
  workId?: string;
  revisionId?: string;
  artifactId?: string;
  /** 校正画面で選んだ文字列と前後の文 */
  quote?: string;
  surrounding?: string;
}

export interface RuleProposal {
  id: string;
  kind: ProposalKind;
  categoryCode: string;
  /** change のときの対象 */
  ruleId?: string;
  title: string;
  correct: string[];
  incorrect: string[];
  patterns: string[];
  exceptions: ExceptionCondition[];
  reason: string;
  context: ProposalContext;
  status: ProposalStatus;
  dedupeKey: string;
  proposedBy: UserId;
  proposedAt: Instant;
  supporters: UserId[];
  decidedBy?: UserId;
  decidedAt?: Instant;
  decisionNote?: string;
  /** 承認でできた（変わった）ルールとその版 */
  resultRuleId?: string;
  resultRevision?: number;
}

/** 重複判定のキー（カテゴリ・対象ルール・誤表記・統一表記の組。順序と空白・全角半角の違いは無視） */
export function proposalDedupeKey(
  p: Pick<RuleProposal, "kind" | "categoryCode" | "ruleId" | "correct" | "incorrect" | "patterns">,
): string {
  const norm = (xs: readonly string[]) =>
    xs
      .map((x) => x.normalize("NFKC").trim())
      .filter(Boolean)
      .sort()
      .join("\u0001");
  return fnv1a(
    [
      p.kind,
      p.categoryCode,
      p.ruleId ?? "",
      norm(p.correct),
      norm(p.incorrect),
      norm(p.patterns),
    ].join("\u0002"),
  );
}
