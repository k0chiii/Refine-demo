import { useAuthToken } from "@convex-dev/auth/react";
import { artifactFormatLabel, isReviewableArtifact, type Artifact } from "@mf100/domain";
import { downloadArtifact } from "@/integrations/api";
import { formatBytes } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { M3eIcon, M3eIconButton, M3eList, M3eListItem } from "@/ui/m3e";

const iconOf = (a: Pick<Artifact, "type">) =>
  a.type === "pdf"
    ? "picture_as_pdf"
    : a.type === "image"
      ? "image"
      : a.type === "document"
        ? "article"
        : a.type === "external_link"
          ? "link"
          : "draft";

/**
 * 情報 › この版のファイル（利用者指示 2026-10-15: 画像の制作物は PDF と .ai を一緒に出し、コメントは基本 PDF に付ける。
 * .ai を手元で開きたい人がいる）。版のすべての添付を並べ、どれも元のファイル名でダウンロードできる。
 * 紙面に出している添付には「コメントはこのファイルに」を添える。外部リンクはリンクとして開く。
 */
export function RevisionFiles({
  artifacts,
  shownId,
}: {
  artifacts: readonly Artifact[];
  /** 紙面に出している添付 */
  shownId: string | null;
}) {
  const token = useAuthToken();
  const download = useAction(async (a: Artifact) => {
    if (!token) return;
    await downloadArtifact(token, a.id, a.fileName);
  });
  if (artifacts.length === 0) return null;
  return (
    <section className="info-tab__section" aria-label="この版のファイル">
      <h2 className="info-tab__h">この版のファイル</h2>
      <M3eList className="list revision-files" aria-label="この版のファイル">
        {artifacts.map((a) => (
          <M3eListItem key={a.id} className="list__item">
            <M3eIcon slot="leading" name={iconOf(a)} />
            <span className="list__headline revision-files__name">{a.fileName}</span>
            <span slot="supporting-text">
              {artifactFormatLabel(a)}
              {a.size ? `・${formatBytes(a.size)}` : ""}
              {a.id === shownId
                ? "・紙面に表示中（コメントはこのファイルに）"
                : a.role !== "external" && !isReviewableArtifact(a)
                  ? "・ダウンロードして開く"
                  : ""}
            </span>
            {a.role === "external" && a.externalUrl ? (
              <a
                slot="trailing"
                className="revision-files__link"
                href={a.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`${a.fileName} を開く`}
                title="開く"
              >
                <M3eIcon name="open_in_new" />
              </a>
            ) : (
              <M3eIconButton
                slot="trailing"
                aria-label={`${a.fileName} をダウンロード`}
                title="ダウンロード"
                disabled={download.pending || a.status !== "verified"}
                onClick={() => void download.run(a)}
              >
                <M3eIcon name="download" />
              </M3eIconButton>
            )}
          </M3eListItem>
        ))}
      </M3eList>
    </section>
  );
}
