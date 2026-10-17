import type { ArtifactType, MediaType } from "@mf100/domain";
import { lazy } from "react";
import { Loading } from "@/ui/Loading";

/**
 * 紙面のビューアのうち大きなものを、初めて使う添付を開くまで読み込まない。
 * - PDF（PDF.js 本体。約 400KB 圧縮前 / 130KB 圧縮後）、書式付きの文章（TipTap・ProseMirror。約 500KB / 160KB）、
 *   動画、Web のライブ表示、Figma の埋め込み
 * - 以前は Editor が全部を静的に import していたため、PDF を開くだけで TipTap を、文章を開くだけで PDF.js を読み込んでいた
 *   （docs/UI_M3E.md §60）。画像・平文（TextViewer）は小さいのでそのまま
 * 使う側は <Suspense fallback={<ViewerLoading />}> で包む。
 */
export const PdfViewer = lazy(() => import("./PdfViewer").then((m) => ({ default: m.PdfViewer })));
export const RichTextViewer = lazy(() =>
  import("./RichTextViewer").then((m) => ({ default: m.RichTextViewer })),
);
export const VideoViewer = lazy(() =>
  import("./VideoViewer").then((m) => ({ default: m.VideoViewer })),
);
export const WebLiveViewer = lazy(() =>
  import("./WebLiveViewer").then((m) => ({ default: m.WebLiveViewer })),
);
export const FigmaEmbedViewer = lazy(() =>
  import("./FigmaEmbedViewer").then((m) => ({ default: m.FigmaEmbedViewer })),
);

/**
 * 制作物の媒体が分かった時点（works.get が届いた時点）で、その媒体のビューアを読み込み始める。
 * 添付の種類が確定する（revisions.get とファイルの取得が済む）のを待ってから読み込むと、その分だけ紙面が出るのが遅れる
 * （直列になる）。媒体ごとの見込みで先に取りに行けば、ファイルの取得と並行して済む。見込みが外れても遅延読み込みが働くだけ
 */
export function preloadViewers(kind: MediaType | ArtifactType): void {
  const tasks: Array<() => Promise<unknown>> = [];
  switch (kind) {
    case "pdf":
    case "image":
    case "other":
      tasks.push(() => import("./PdfViewer"));
      break;
    case "document":
      tasks.push(
        () => import("./RichTextViewer"),
        () => import("@/features/writing/markdown"),
      );
      break;
    case "video":
      tasks.push(() => import("./VideoViewer"));
      break;
    case "web":
      tasks.push(() => import("./WebLiveViewer"));
      break;
    case "figma":
      tasks.push(
        () => import("./FigmaEmbedViewer"),
        () => import("./PdfViewer"),
      );
      break;
    case "sns":
    case "external_link":
      break;
  }
  for (const t of tasks) t().catch(() => undefined);
}

/** ビューアの読み込み中（ファイルの取得中と同じ見せ方。M3E の Loading indicator。docs/UI_M3E.md §59） */
export function ViewerLoading({ className }: { className?: string }) {
  return (
    <Loading
      calm
      label="ビューアを読み込んでいます"
      caption
      {...(className ? { className } : {})}
    />
  );
}
