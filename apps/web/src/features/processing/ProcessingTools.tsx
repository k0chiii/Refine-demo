import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { M3eDialog } from "@/ui/LazyDialog";
import { API_URL } from "@/integrations/api";
import { useAction } from "@/lib/useAction";

type Kind = "image" | "video-frame" | "stream" | "web-snapshot" | "container-preview";
const labels: Record<Kind, string> = {
  image: "画像プレビュー",
  "video-frame": "動画の静止画",
  stream: "動画の配信用コピー",
  "web-snapshot": "公開ページの画像",
  "container-preview": "変換プレビュー",
};
export function ProcessingTools(props: {
  workId: string;
  artifactId: string | null;
  mimeType?: string;
}) {
  if (import.meta.env.MODE === "demo") return null;
  return <LiveProcessingTools {...props} />;
}
function LiveProcessingTools({
  workId,
  artifactId,
  mimeType,
}: {
  workId: string;
  artifactId: string | null;
  mimeType?: string;
}) {
  const token = useAuthToken();
  const status = useQuery(api.processing.status, { workId });
  const cancel = useMutation(api.processing.cancel);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("image");
  const [url, setUrl] = useState("");
  const [time, setTime] = useState(0);
  const [consent, setConsent] = useState(false);
  const [jobId, setJobId] = useState<Id<"processingJobs"> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const job = useQuery(api.processing.get, jobId ? { jobId } : "skip");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const start = useAction(async () => {
    const response = await fetch(`${API_URL}/processing/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        consentToProcessing: consent,
        options:
          kind === "web-snapshot"
            ? { workId, url }
            : {
                artifactId,
                ...(kind === "video-frame" || kind === "container-preview" ? { time } : {}),
              },
      }),
    });
    if (!response.ok) throw new Error("処理を開始できませんでした");
    const result = (await response.json()) as { jobId: Id<"processingJobs"> };
    setJobId(result.jobId);
    setPreview(null);
  });
  const stop = useAction(async () => {
    if (jobId) await cancel({ jobId });
  });
  const show = useAction(async () => {
    const response = await fetch(`${API_URL}/processing/files/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("プレビューを取得できませんでした");
    setPreview(URL.createObjectURL(await response.blob()));
  });
  if (!status?.enabled) return null;
  const available = (Object.keys(labels) as Kind[]).filter(
    (k) =>
      status.kinds.includes(k) &&
      (k === "web-snapshot" ||
        (artifactId &&
          (k === "image"
            ? mimeType?.startsWith("image/")
            : k === "container-preview"
              ? mimeType === "application/pdf" || mimeType?.startsWith("video/")
              : mimeType?.startsWith("video/")))),
  );
  if (!available.length) return null;
  const selected = available.includes(kind) ? kind : available[0]!;
  const pending = job?.state === "queued" || job?.state === "running";
  return (
    <>
      <M3eButton
        variant="text"
        onClick={() => {
          setKind(selected);
          setOpen(true);
        }}
      >
        派生プレビュー
      </M3eButton>
      <M3eDialog open={open} onClosed={() => setOpen(false)} closeLabel="閉じる">
        <span slot="header">派生プレビューを作成</span>
        <div className="dialog-body stack">
          <label>
            処理
            <select value={selected} onChange={(e) => setKind(e.target.value as Kind)}>
              {available.map((k) => (
                <option value={k} key={k}>
                  {labels[k]}
                </option>
              ))}
            </select>
          </label>
          {selected === "web-snapshot" ? (
            <label>
              公開ページの URL
              <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
          ) : null}
          {selected === "video-frame" || selected === "container-preview" ? (
            <label>
              時点（秒）
              <input
                type="number"
                min={0}
                max={3600}
                value={time}
                onChange={(e) => setTime(Number(e.target.value))}
              />
            </label>
          ) : null}
          <p>Cloudflare で処理し、原本とは別のファイルを保存します。提出済みの版は変更しません。</p>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            処理と派生物の保存に同意する
          </label>
          {pending ? (
            <p role="status">
              処理中です{" "}
              <M3eButton variant="text" disabled={stop.pending} onClick={() => void stop.run()}>
                中止
              </M3eButton>
            </p>
          ) : null}
          {job?.error ? <p role="alert">{job.error}</p> : null}
          {job?.state === "ready" && job.output?.key ? (
            <M3eButton variant="outlined" onClick={() => void show.run()}>
              プレビューを表示
            </M3eButton>
          ) : null}
          {preview ? (
            <img src={preview} alt="生成したプレビュー" style={{ maxWidth: "100%" }} />
          ) : null}
          {job?.state === "ready" && job.output?.streamUid && token && jobId ? (
            <StreamPreview jobId={jobId} token={token} />
          ) : null}
        </div>
        <div slot="actions">
          <M3eButton
            variant="filled"
            disabled={!consent || pending || start.pending}
            onClick={() => void start.run()}
          >
            作成
          </M3eButton>
        </div>
      </M3eDialog>
    </>
  );
}
function StreamPreview({ jobId, token }: { jobId: string; token: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    let dispose: (() => void) | undefined;
    void import("hls.js").then(({ default: Hls }) => {
      if (stopped) return;
      if (!Hls.isSupported() || !video.current) {
        setError(true);
        return;
      }
      const hls = new Hls({
        xhrSetup: (xhr) => xhr.setRequestHeader("Authorization", `Bearer ${token}`),
      });
      hls.loadSource(`${API_URL}/processing/stream/${jobId}/manifest/video.m3u8`);
      hls.attachMedia(video.current);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError(true);
      });
      dispose = () => hls.destroy();
    });
    return () => {
      stopped = true;
      dispose?.();
    };
  }, [jobId, token]);
  return (
    <>
      {error ? (
        <p role="status">配信用動画をまだ再生できません。変換完了後に開き直してください。</p>
      ) : null}
      <video ref={video} controls playsInline style={{ maxWidth: "100%" }} />
    </>
  );
}
