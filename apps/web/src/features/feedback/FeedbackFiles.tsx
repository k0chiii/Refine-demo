import { useAuthToken } from "@convex-dev/auth/react";
import { artifactFormatLabel } from "@mf100/domain";
import { useEffect, useState } from "react";
import { downloadFeedbackFile, fetchFeedbackFileBlob } from "@/integrations/api";
import { formatBytes } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { M3eDialog, M3eIcon, M3eIconButton } from "@/ui/m3e";
import { iconFor } from "./FeedbackComposer";

export interface FeedbackFileView {
  id: string;
  fileName: string;
  mimeType: string;
  type: "pdf" | "image" | "document" | "other";
  size?: number | null;
  status: string;
}

/** 添付を認可付きで取得して Blob URL にする（R2 の署名 URL は使わない。消えたら破棄） */
function useFeedbackBlob(fileId: string | null) {
  const token = useAuthToken();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!fileId || !token) return;
    let cancelled = false;
    let made: string | null = null;
    fetchFeedbackFileBlob(token, fileId)
      .then((b) => {
        if (cancelled) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fileId, token]);
  return url;
}

function ImageThumb({ file, onOpen }: { file: FeedbackFileView; onOpen: (url: string) => void }) {
  const url = useFeedbackBlob(file.id);
  return (
    <button
      type="button"
      className="fb-thumb"
      aria-label={`${file.fileName} を大きく見る`}
      disabled={!url}
      onClick={() => url && onOpen(url)}
    >
      {url ? <img src={url} alt="" /> : <span className="fb-thumb__loading" />}
    </button>
  );
}

/**
 * 投稿の添付。画像はその場に縮小して並べ（押すと大きく表示）、PDF は開く（ブラウザの PDF 表示）とダウンロード、
 * .ai などはダウンロードだけ（利用者指示 2026-10-15: PDF・画像はその場で表示、.ai はダウンロード）。
 */
export function FeedbackFiles({ files }: { files: readonly FeedbackFileView[] }) {
  const token = useAuthToken();
  const [big, setBig] = useState<{ url: string; name: string } | null>(null);
  const download = useAction(async (f: FeedbackFileView) => {
    if (token) await downloadFeedbackFile(token, f.id, f.fileName);
  });
  const openPdf = useAction(async (f: FeedbackFileView) => {
    if (!token) return;
    const b = await fetchFeedbackFileBlob(token, f.id);
    window.open(URL.createObjectURL(b), "_blank", "noopener");
  });
  if (!files.length) return null;
  const images = files.filter((f) => f.type === "image");
  const others = files.filter((f) => f.type !== "image");
  return (
    <div className="fb-files">
      {images.length ? (
        <div className="fb-files__images">
          {images.map((f) => (
            <ImageThumb key={f.id} file={f} onOpen={(url) => setBig({ url, name: f.fileName })} />
          ))}
        </div>
      ) : null}
      {others.map((f) => (
        <div key={f.id} className="fb-file-chip">
          <M3eIcon name={iconFor(f.type)} />
          <span className="fb-file-chip__name">{f.fileName}</span>
          <span className="muted small">
            {artifactFormatLabel(f)}
            {f.size ? `・${formatBytes(f.size)}` : ""}
          </span>
          {f.type === "pdf" ? (
            <M3eIconButton
              aria-label={`${f.fileName} を開く`}
              title="開く"
              onClick={() => void openPdf.run(f)}
            >
              <M3eIcon name="open_in_new" />
            </M3eIconButton>
          ) : null}
          <M3eIconButton
            aria-label={`${f.fileName} をダウンロード`}
            title="ダウンロード"
            onClick={() => void download.run(f)}
          >
            <M3eIcon name="download" />
          </M3eIconButton>
        </div>
      ))}
      <M3eDialog
        open={big !== null}
        onClosed={() => setBig(null)}
        closeLabel="閉じる"
        className="dialog--full fb-image-dialog"
      >
        <span slot="header">{big?.name}</span>
        <div className="dialog-body">{big ? <img src={big.url} alt={big.name} /> : null}</div>
      </M3eDialog>
    </div>
  );
}
