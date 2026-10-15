import type { Anchor, NormalizedRect } from "../comment/Anchor.ts";
import { TEXT_QUOTE_MAX } from "../comment/Anchor.ts";
import type { Severity } from "../comment/CommentThread.ts";
import type { Instant } from "../shared/time.ts";
import type { Detector, Finding, FindingConfidence } from "./proofreader.ts";
import { proofread } from "./proofreader.ts";
import type { EffectiveRule } from "./ruleset.ts";
import { fnv1a } from "./ruleset.ts";

/**
 * 版の提出時の自動校正（表記統一）。
 * - 指摘は通常のコメント（スレッド）として作る。投稿者は人ではなくシステム（PROOFREADER_ID）。実在しない人の ID は使わない
 * - 文字の取り出し（PDF.js・OCR）は利用者のブラウザで行い、ルールの照合はサーバーでやり直す（ブラウザの照合結果は信用しない）
 * - 同じ箇所・同じルールの指摘は指紋で 1 件にまとめ、再実行しても増えない
 * - 自動で解決済みにしない。返信・採否判断・持越は人の指摘と同じ
 */
export const PROOFREADER_ID = "bot:proofreader";
export const PROOFREADER_NAME = "自動校正";

export function isBotAuthor(id: string): boolean {
  return id.startsWith("bot:");
}

/** どこから文字を得たか（指摘の信頼度の説明に使う） */
export type TextSource = "document" | "pdf_text" | "ocr";

/** 自動校正の指摘であることと、その根拠（ルールと版） */
export interface BotOrigin {
  kind: "bot";
  detector: Detector;
  ruleId: string;
  ruleRevision: number;
  runId: string;
  fingerprint: string;
  confidence: FindingConfidence;
  needsReview: boolean;
  original: string;
  suggestion: string;
  textSource: TextSource;
}

/** ブラウザから送る文字の単位 */
export type ProofreadSegment =
  /** 文章の版（平文全体）。指摘は text_range */
  | { kind: "text"; text: string }
  /** PDF の 1 ページ。boxes は平文の [start, end) とページ上の正規化矩形の対応（PDF.js のテキスト項目ごと） */
  | {
      kind: "page";
      page: number;
      text: string;
      boxes: TextBox[];
      /** 文字の無いページを OCR で読んだときの信頼度（0..1）。PDF の文字なら無し */
      ocrConfidence?: number;
    }
  /** 画像の OCR。confidence は 0..1 */
  | { kind: "image"; text: string; boxes: TextBox[]; confidence: number };

export interface TextBox {
  start: number;
  end: number;
  rect: NormalizedRect;
}

export const SEGMENT_TEXT_MAX = 200_000;
export const SEGMENTS_MAX = 2000;
/** 1 つの添付で作る指摘の上限（大量の指摘で校正画面が埋まらないように） */
export const BOT_THREADS_PER_ARTIFACT = 300;

export interface PlannedBotThread {
  fingerprint: string;
  anchor: Anchor;
  body: string;
  severity: Severity;
  finding: Finding;
  origin: Omit<BotOrigin, "runId">;
}

function unionRect(boxes: readonly TextBox[], start: number, end: number): NormalizedRect | null {
  const hit = boxes.filter((b) => b.start < end && start < b.end && b.rect.w > 0 && b.rect.h > 0);
  if (!hit.length) return null;
  const x0 = Math.min(...hit.map((b) => b.rect.x));
  const y0 = Math.min(...hit.map((b) => b.rect.y));
  const x1 = Math.max(...hit.map((b) => b.rect.x + b.rect.w));
  const y1 = Math.max(...hit.map((b) => b.rect.y + b.rect.h));
  // 1 文字分ではなく項目全体の矩形になるので、項目の中での位置で横方向を絞る（1 行の項目のとき）
  if (hit.length === 1) {
    const b = hit[0]!;
    const len = Math.max(1, b.end - b.start);
    const a = Math.max(0, start - b.start) / len;
    const z = Math.min(len, end - b.start) / len;
    const x = b.rect.x + b.rect.w * a;
    const w = Math.max(b.rect.w * (z - a), 0.004);
    return clampRect({ x, y: b.rect.y, w, h: b.rect.h });
  }
  return clampRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

function clampRect(r: NormalizedRect): NormalizedRect {
  const x = Math.min(Math.max(r.x, 0), 0.999);
  const y = Math.min(Math.max(r.y, 0), 0.999);
  return {
    x,
    y,
    w: Math.max(0.001, Math.min(r.w, 1 - x)),
    h: Math.max(0.001, Math.min(r.h, 1 - y)),
  };
}

const severityOf = (f: Finding): Severity =>
  f.strictness === "required" && !f.needsReview ? "minor" : "info";

/** 自動校正のコメントの本文（ルールと理由。人が読む文） */
export function botBody(f: Finding): string {
  const head = f.suggestion ? `「${f.original}」→「${f.suggestion}」` : `「${f.original}」`;
  const lead = f.needsReview ? "【要確認】" : "";
  const reason = f.reason || f.title;
  const ex = f.exceptionNote ? `\n例外: ${f.exceptionNote}` : "";
  return `${lead}${head}\n${reason}${ex}\n（表記ルール ${f.ruleId} 改訂 ${f.ruleRevision}）`;
}

/**
 * 送られた文字にルールを当て、作るスレッドを計画する（サーバーで実行する）。
 * 位置が求まらない指摘（矩形の無い文字）は作らない。
 */
export function planBotThreads(
  artifactId: string,
  segments: readonly ProofreadSegment[],
  rules: readonly EffectiveRule[],
  /** 作ってよい数（添付ごとの上限から保存済みの数を引いた残り）。既定は上限そのもの */
  limit: number = BOT_THREADS_PER_ARTIFACT,
): { planned: PlannedBotThread[]; truncated: boolean } {
  const planned: PlannedBotThread[] = [];
  if (limit <= 0) return { planned, truncated: segments.length > 0 };
  let truncated = false;
  for (const seg of segments.slice(0, SEGMENTS_MAX)) {
    const text = seg.text.slice(0, SEGMENT_TEXT_MAX);
    const ocrConfidence =
      seg.kind === "image" ? seg.confidence : seg.kind === "page" ? seg.ocrConfidence : undefined;
    const isOcr = ocrConfidence !== undefined;
    const r = proofread(text, rules, {
      source: isOcr ? "ocr" : "text",
      ...(isOcr ? { ocrConfidence } : {}),
      timeBudgetMs: 2000,
    });
    truncated ||= r.truncated;
    for (const f of r.findings) {
      let anchor: Anchor | null = null;
      if (seg.kind === "text") {
        anchor = {
          type: "text_range",
          artifactId,
          start: f.start,
          end: f.end,
          quote: text.slice(f.start, f.end).slice(0, TEXT_QUOTE_MAX),
        };
      } else {
        const rect = unionRect(seg.boxes, f.start, f.end);
        if (rect)
          anchor =
            seg.kind === "page"
              ? { type: "pdf_rect", artifactId, page: seg.page, rect }
              : { type: "image_rect", artifactId, rect };
      }
      if (!anchor) continue;
      const page = seg.kind === "page" ? seg.page : 0;
      const fingerprint = fnv1a(`${artifactId}|${page}|${f.ruleId}|${f.start}|${f.original}`);
      planned.push({
        fingerprint,
        anchor,
        body: botBody(f),
        severity: severityOf(f),
        finding: f,
        origin: {
          kind: "bot",
          detector: f.detector,
          ruleId: f.ruleId,
          ruleRevision: f.ruleRevision,
          fingerprint,
          confidence: f.confidence,
          needsReview: f.needsReview,
          original: f.original,
          suggestion: f.suggestion,
          textSource: seg.kind === "text" ? "document" : isOcr ? "ocr" : "pdf_text",
        },
      });
      if (planned.length >= limit) return { planned, truncated: true };
    }
  }
  return { planned, truncated };
}

/**
 * 添付ごとの上限（BOT_THREADS_PER_ARTIFACT）のうち、まだ作れる数。
 * 分割送信（partial）や再送でも合計が上限を超えないよう、保存済みの数（同じ実行・同じ添付）を差し引く。
 */
export function remainingBotThreadQuota(storedForArtifact: number): number {
  return Math.max(0, BOT_THREADS_PER_ARTIFACT - storedForArtifact);
}

/** 自動校正の実行（版ごとに 1 件。重い処理はブラウザ、記録と照合はサーバー） */
export type RunArtifactStatus = "pending" | "running" | "done" | "failed" | "skipped";
export interface ProofreadingRun {
  id: string;
  workId: string;
  revisionId: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  snapshotHash: string;
  artifacts: Array<{
    artifactId: string;
    status: RunArtifactStatus;
    findings: number;
    source?: TextSource;
    error?: string;
    /** 処理中の端末が持つ期限（切れたら他の端末が引き継げる） */
    leaseUntil?: Instant;
  }>;
  attempts: number;
  createdAt: Instant;
  updatedAt: Instant;
  note?: string;
}

/** 添付の状態から実行全体の状態を決める */
export function runStatusOf(artifacts: ProofreadingRun["artifacts"]): ProofreadingRun["status"] {
  if (artifacts.length === 0) return "skipped";
  if (artifacts.some((a) => a.status === "pending" || a.status === "running"))
    return artifacts.some((a) => a.status !== "pending") ? "running" : "pending";
  if (artifacts.some((a) => a.status === "failed")) return "failed";
  if (artifacts.every((a) => a.status === "skipped")) return "skipped";
  return "done";
}

/** 自動校正の対象になる添付の種類 */
export function proofreadableType(type: string): boolean {
  return type === "pdf" || type === "document" || type === "image";
}
