import { DomainError } from "../shared/DomainError.ts";
import { isPostDraftContent } from "../social/post.ts";
import type { Instant } from "../shared/time.ts";
import type { UserId, WorkId } from "../shared/ids.ts";
import type { MediaType } from "../work/Work.ts";

/**
 * 文章の下書き（F-12 の前段: 制作者がアプリ内で文章を書き、版として提出する）。
 * 1 つの制作物に 1 つ。本文はエディタ（ProseMirror）の JSON をそのまま文字列で持ち、検索・文字数用に平文も持つ。
 *
 * 共同編集（同時に複数人が書く）は要件どおり後続（§3.2）。ここでは版番号による楽観的排他だけを行い、
 * 他の人が先に保存していたら `version_conflict` で止めて、利用者に最新を読み込ませる。
 */
export interface DocumentDraft {
  id: string;
  workId: WorkId;
  title: string;
  /** ProseMirror の doc（JSON 文字列） */
  content: string;
  /** 平文（段落は改行区切り）。文字数・検索・提出時の確認に使う */
  text: string;
  version: number;
  updatedBy: UserId;
  updatedAt: Instant;
}

/**
 * Convex の 1 ドキュメント上限（1MiB = 1,048,576 バイト）に余裕を残した上限。
 * 本文（content）と平文（text）は同じ文章を二重に持つので、個別の上限に加えて
 * 「題名・本文・平文の UTF-8 バイト数の合計＋項目名などの余白（metadataBytes）」が totalBytes 以下であることを確かめる。
 */
export const DOCUMENT_LIMITS = {
  titleChars: 200,
  contentBytes: 700_000,
  textChars: 200_000,
  /** 保存する 1 件の合計（題名・本文・平文・余白）。1MiB より約 10% 小さくする */
  totalBytes: 950_000,
  /** 項目名・版番号・更新者などの余白として見込む量 */
  metadataBytes: 1_024,
} as const;

/**
 * 下書きの形式。SNS 投稿の制作物は投稿の内容（mf100-post）、それ以外は文章（ProseMirror の doc）。
 * 通常の保存では形式を変えない（文章の下書きを投稿で上書きして原稿を失わないため）。
 */
export type DraftFormat = "document" | "post";

export const draftFormatLabels: Record<DraftFormat, string> = {
  document: "文章",
  post: "SNS 投稿",
};

/** 制作物の媒体に合う下書きの形式（エディタの選び分け `submitRouteFor` と同じ規則） */
export function draftFormatFor(mediaType: MediaType): DraftFormat {
  return mediaType === "sns" ? "post" : "document";
}

/** 保存されている本文の形式（どちらでもなければ null） */
export function draftFormatOf(content: string): DraftFormat | null {
  if (isPostDraftContent(content)) return "post";
  if (isDocumentContent(content)) return "document";
  return null;
}

export interface DraftSaveInput {
  title: string;
  content: string;
  text: string;
  /** 編集を始めた時点の版番号。新規は 0 */
  baseVersion: number;
  /**
   * 別の形式の下書きを置き換える明示的な操作（制作物の媒体を変えた後など）。
   * これが無い通常の保存では、保存済みの下書きと形式が違えば `document_format_mismatch` で止める
   */
  replaceFormat?: boolean;
}

/** UTF-8 のバイト数（ドメインは実行環境の API に依存しないので自前で数える） */
export function byteLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** 本文が ProseMirror の doc として読めるか（中身の妥当性はエディタのスキーマが表示時に保証する） */
export function isDocumentContent(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "doc" &&
      Array.isArray((parsed as { content?: unknown }).content ?? [])
    );
  } catch {
    return false;
  }
}

/** 保存する 1 件の大きさの見積もり（UTF-8。題名・本文・平文と余白） */
export function draftStoredBytes(d: Pick<DocumentDraft, "title" | "content" | "text">): number {
  return (
    byteLength(d.title) + byteLength(d.content) + byteLength(d.text) + DOCUMENT_LIMITS.metadataBytes
  );
}

/**
 * 下書きを保存した後の状態を返す（保存先の永続化は呼び出し側）。
 * - 版番号が食い違えば `version_conflict`（他の人の保存を上書きしない）
 * - 大きすぎる・壊れた本文は `document_invalid`。本文と平文を合わせて大きすぎれば `document_too_large`
 * - 制作物の媒体に合わない形式、または保存済みの下書きと違う形式（明示の置き換えでない）は `document_format_mismatch`
 */
export function nextDraft(
  current: DocumentDraft | null,
  input: DraftSaveInput,
  actor: UserId,
  now: Instant,
  workId: WorkId,
  mediaType: MediaType,
): Omit<DocumentDraft, "id"> {
  const currentVersion = current?.version ?? 0;
  if (input.baseVersion !== currentVersion)
    throw new DomainError("version_conflict", {
      expected: input.baseVersion,
      actual: currentVersion,
      updatedBy: current?.updatedBy ?? null,
    });
  const title = input.title.trim();
  if (title.length > DOCUMENT_LIMITS.titleChars)
    throw new DomainError("document_invalid", { reason: "title_too_long" });
  if (byteLength(input.content) > DOCUMENT_LIMITS.contentBytes)
    throw new DomainError("document_invalid", { reason: "content_too_large" });
  if (input.text.length > DOCUMENT_LIMITS.textChars)
    throw new DomainError("document_invalid", { reason: "text_too_long" });
  // SNS 投稿の制作物は同じ保存先に投稿の内容（mf100-post）を保存する
  const format = draftFormatOf(input.content);
  if (format === null)
    throw new DomainError("document_invalid", { reason: "content_not_document" });
  const expected = draftFormatFor(mediaType);
  if (format !== expected)
    throw new DomainError("document_format_mismatch", {
      reason: "media_type",
      expected,
      actual: format,
    });
  const stored = current ? draftFormatOf(current.content) : null;
  if (stored !== null && stored !== format && !input.replaceFormat)
    throw new DomainError("document_format_mismatch", {
      reason: "existing_draft",
      expected: stored,
      actual: format,
    });
  const bytes = draftStoredBytes({ title, content: input.content, text: input.text });
  if (bytes > DOCUMENT_LIMITS.totalBytes)
    throw new DomainError("document_too_large", { bytes, max: DOCUMENT_LIMITS.totalBytes });
  return {
    workId,
    title,
    content: input.content,
    text: input.text,
    version: currentVersion + 1,
    updatedBy: actor,
    updatedAt: now,
  };
}

/** 文字数の数え方（Google ドキュメントの「文字カウント」に合わせる） */
export interface TextCounts {
  /** 単語数。英数字のまとまりを 1 語、かな・漢字は 1 文字を 1 語として数える */
  words: number;
  /** 文字数（改行は数えない） */
  characters: number;
  /** 文字数（空白を除く） */
  charactersNoSpaces: number;
}

export function countText(text: string): TextCounts {
  const noBreaks = text.replace(/\r?\n/g, "");
  const chars = Array.from(noBreaks);
  const latinWords = text.match(/[\p{Script=Latin}\p{Nd}_'’-]+/gu) ?? [];
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? [];
  return {
    words: latinWords.length + cjk.length,
    characters: chars.length,
    charactersNoSpaces: chars.filter((c) => !/\s/u.test(c)).length,
  };
}
