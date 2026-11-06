import { bodyOfHtml, isHtmlArtifact, isMarkdownArtifact } from "./plainText";

/**
 * 文章の原稿（提出されたファイル）を校正画面で読む形にする。原稿のファイル自体は変えない。
 * - HTML（文章エディタからの提出など）: 本文を整形して表示
 * - Markdown（.md）: 文章エディタと同じ構造に読み込んで整形して表示（原稿は Markdown のまま）
 * - それ以外の文字（.txt など）: そのまま
 * body は範囲コメントの位置（文字の番号）の基準。校正画面・版比較・自動校正で同じものを使う。
 *
 * 整形に使う TipTap・marked（圧縮前 500KB 超）は HTML・Markdown のときだけ読み込む（非同期）。
 * 平文（.txt）の校正や自動校正の文字抜き出しでは引き込まない（docs/UI_M3E.md §60）
 */
export async function documentView(
  artifact: { fileName: string; mimeType?: string | null },
  raw: string,
): Promise<{ body: string; html?: string }> {
  if (isHtmlArtifact({ fileName: artifact.fileName, mimeType: artifact.mimeType ?? "" })) {
    const { htmlToPlainText } = await import("@/features/annotation/RichTextViewer");
    const html = bodyOfHtml(raw);
    return { body: htmlToPlainText(html), html };
  }
  if (isMarkdownArtifact(artifact)) {
    const [{ markdownToHtml }, { htmlToPlainText }] = await Promise.all([
      import("./markdown"),
      import("@/features/annotation/RichTextViewer"),
    ]);
    const html = markdownToHtml(raw);
    return { body: htmlToPlainText(html), html };
  }
  return { body: raw };
}
