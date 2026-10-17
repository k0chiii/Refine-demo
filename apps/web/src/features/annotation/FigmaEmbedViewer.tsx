import {
  figmaDeepLink,
  figmaEmbedUrl,
  parseFigmaUrl,
  type Anchor,
  type Viewport,
} from "@mf100/domain";
import { useMemo, type ReactNode } from "react";
import type { OverlayThread } from "./AnchorOverlay";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eMenu, M3eMenuItemRadio, M3eMenuTrigger } from "@m3e/react/menu";

type FigmaAnchor = Extract<Anchor, { type: "figma_node" }>;

export interface FigmaFrameArtifact {
  id: string;
  externalUrl: string;
}

/** フレーム単位のコメントの下書き（このフレームについて） */
export interface FigmaDraft {
  fileKey: string;
  nodeId: string;
  nodeName?: string;
}

interface Props {
  /** この版の Figma の URL の添付（フレームごとに 1 つ） */
  frames: FigmaFrameArtifact[];
  currentId: string;
  onSwitch: (artifactId: string) => void;
  threads: OverlayThread[];
  selecting: boolean;
  /** 「このフレームにコメント」 */
  onCommentFrame: (d: FigmaDraft) => void;
  renderInPage?: (vp: Viewport) => ReactNode;
  footer?: ReactNode;
  /** 埋め込みの読み込みが終わった（親はそれまで紙面を隠して読み込み中の指標を出す。docs/UI_M3E.md §61） */
  onReady?: () => void;
}

/** 添付の URL からフレームの表示名（URL のファイル名 › ノード ID） */
export function figmaFrameLabel(url: string, index: number): string {
  const ref = parseFigmaUrl(url);
  if (!ref) return `フレーム ${index + 1}`;
  return ref.nodeId ? `${ref.fileName ?? "Figma"} › ${ref.nodeId}` : (ref.fileName ?? "Figma");
}

/**
 * Figma の埋め込み表示（Embed Kit 2.0。docs/FIGMA_WEB_PROOFING.md FG-07・FG-10。利用者決定 2026-10-17）。
 * 埋め込みは位置（座標・拡大率）を返さないので、コメントは「このフレーム（ノード）について」の単位（figma_node）。
 * 位置を指すコメントは、Figma から取り込んだ画像（添付）の上で付ける。Figma 側のログインが要ることがあるので
 * 「Figma で開く」を常に置く。
 */
export function FigmaEmbedViewer({
  frames,
  currentId,
  onSwitch,
  threads,
  selecting,
  onCommentFrame,
  renderInPage,
  footer,
  onReady,
}: Props) {
  const current = frames.find((f) => f.id === currentId) ?? frames[0];
  const ref = current ? parseFigmaUrl(current.externalUrl) : null;
  const embed = current ? figmaEmbedUrl(current.externalUrl) : "";
  const deep = ref ? figmaDeepLink(ref) : (current?.externalUrl ?? "#");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads)
      if (t.anchor.type === "figma_node")
        m.set(t.anchor.artifactId, (m.get(t.anchor.artifactId) ?? 0) + 1);
    return m;
  }, [threads]);
  const labelOf = (f: FigmaFrameArtifact, i: number) => {
    const n = counts.get(f.id) ?? 0;
    return `${figmaFrameLabel(f.externalUrl, i)}${n ? `（${n}）` : ""}`;
  };
  const here = threads.filter(
    (t): t is OverlayThread & { anchor: FigmaAnchor } =>
      t.anchor.type === "figma_node" && t.anchor.artifactId === current?.id,
  );
  if (!current) return <div className="empty">Figma のリンクがありません</div>;
  const vp: Viewport = { width: 0, height: 0, rotation: 0 };

  return (
    <div className="viewer figma-embed">
      <div className="viewer__stage figma-embed__stage">
        <p className="wlive__banner" role="note">
          <M3eIcon name="info" />
          Figma
          の埋め込みは今のファイルの内容で、位置は取れません。コメントは「このフレームについて」として付きます。
          位置を指すには Figma から取り込んだ画像（添付）の上でコメントしてください。Figma
          のサインインを求められることがあります
        </p>
        <div className="wlive__bar" role="toolbar" aria-label="Figma の表示の操作">
          {frames.length > 1 && frames.length <= 4 ? (
            <ChoiceGroup
              label="フレーム"
              className="figma-embed__frames"
              value={current.id}
              onChange={onSwitch}
              choices={frames.map((f, i) => ({ value: f.id, label: labelOf(f, i) }))}
            />
          ) : frames.length > 4 ? (
            <>
              <M3eButton variant="tonal" aria-label="フレームを選ぶ">
                <M3eIcon slot="icon" name="design_services" />
                {labelOf(current, frames.indexOf(current))}
                <M3eMenuTrigger htmlFor="figma-frame-menu" />
              </M3eButton>
              <M3eMenu id="figma-frame-menu">
                {frames.map((f, i) => (
                  <M3eMenuItemRadio
                    key={f.id}
                    checked={f.id === current.id}
                    onClick={() => onSwitch(f.id)}
                  >
                    {labelOf(f, i)}
                  </M3eMenuItemRadio>
                ))}
              </M3eMenu>
            </>
          ) : (
            <span className="wlive__frame-name">
              <M3eIcon name="design_services" />
              {labelOf(current, 0)}
            </span>
          )}
          <span className="spacer" />
          {selecting && ref?.nodeId ? (
            <M3eButton
              variant="tonal"
              onClick={() =>
                onCommentFrame({
                  fileKey: ref.fileKey,
                  nodeId: ref.nodeId!,
                  ...(ref.fileName ? { nodeName: `${ref.fileName} › ${ref.nodeId}` } : {}),
                })
              }
            >
              <M3eIcon slot="icon" name="add_comment" />
              このフレームにコメント
            </M3eButton>
          ) : null}
          <a className="link-button" href={deep} target="_blank" rel="noreferrer noopener">
            <M3eIcon name="open_in_new" />
            Figma で開く
          </a>
        </div>
        <div className="figma-embed__frame">
          <iframe
            className="figma-embed__iframe"
            title={`Figma の埋め込み: ${figmaFrameLabel(current.externalUrl, frames.indexOf(current))}`}
            src={embed}
            allowFullScreen
            onLoad={() => onReady?.()}
            referrerPolicy="strict-origin-when-cross-origin"
          />
          {renderInPage ? (
            <div className="wlive__layer figma-embed__layer">{renderInPage(vp)}</div>
          ) : null}
        </div>
        {here.length > 0 ? (
          <p className="wlive__caption">
            このフレームへのコメント {here.length} 件（右の一覧）。Figma
            側のコメントはここには出ません
          </p>
        ) : null}
        {footer}
      </div>
    </div>
  );
}
