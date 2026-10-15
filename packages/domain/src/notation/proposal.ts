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

const neutralTitles: Record<ProposalKind, string> = {
  new: "新しい表記ルールの提案",
  change: "表記ルールの変更の提案",
  report: "誤表記の報告",
};

/** 題名が空のときや、保護された文脈から題名を作れないときの中立的な題名 */
export function neutralProposalTitle(kind: ProposalKind): string {
  return neutralTitles[kind];
}

/**
 * 元の制作物を見られない人にも出してよい題名（一覧・通知・承認で作るルールの題名に使う）。
 * 題名が保護された文脈（引用・前後の文）と重なるときは中立的な題名にする。
 * 統一表記・誤表記と同じ題名は提案の内容そのもの（文脈を隠しても見える）なので、そのまま出す。
 */
export function publicProposalTitle(
  p: Pick<RuleProposal, "kind" | "title" | "correct" | "incorrect" | "context">,
): string {
  const title = p.title.trim();
  if (!title) return neutralProposalTitle(p.kind);
  const secrets = [p.context.quote, p.context.surrounding]
    .map((s) => s?.trim() ?? "")
    .filter(Boolean);
  if (!secrets.length) return title;
  if ([...p.correct, ...p.incorrect].includes(title)) return title;
  if (secrets.some((s) => s.includes(title) || title.includes(s)))
    return neutralProposalTitle(p.kind);
  return title;
}
