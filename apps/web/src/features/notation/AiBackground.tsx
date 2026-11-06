import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import type { Finding } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { useAction } from "@/lib/useAction";
import { FindingList } from "./FindingList";

export function AiBackground({ workId, getText }: { workId: string; getText: () => string }) {
  const draft = useQuery(api.documents.get, { workId });
  const start = useMutation(api.aiWorkflow.start);
  const cancel = useMutation(api.aiWorkflow.cancel);
  const [id, setId] = useState<Id<"aiJobs"> | null>(null);
  const [consent, setConsent] = useState(false);
  const job = useQuery(api.aiWorkflow.get, id ? { jobId: id } : "skip");
  const submit = useAction(async () => {
    if (!draft?.draft) return;
    setId(
      (await start({
        workId,
        draftVersion: draft.draft.version,
        consentToTemporaryStorage: consent,
      })) as Id<"aiJobs">,
    );
  });
  const stop = useAction(async () => {
    if (id) await cancel({ jobId: id });
  });
  if (!draft?.canEdit || !draft.draft || import.meta.env.MODE === "demo") return null;
  const pending = job?.state === "queued" || job?.state === "running";
  const result = job?.result
    ? (JSON.parse(job.result) as { candidates: Finding[]; provider: string })
    : null;
  return (
    <details>
      <summary>保存した原稿をバックグラウンドで校正する</summary>
      <p className="small muted">
        保存した原稿を AI に送ります。候補は1時間、自分にだけ表示されます
      </p>
      <label>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        候補の一時保存に同意する
      </label>
      <M3eButton
        variant="outlined"
        disabled={!consent || pending || submit.pending || draft.draft.text !== getText()}
        onClick={() => void submit.run()}
      >
        保存した原稿を送信
      </M3eButton>
      {pending ? (
        <div role="status">
          AI が確認しています{" "}
          <M3eButton variant="text" disabled={stop.pending} onClick={() => void stop.run()}>
            中止
          </M3eButton>
        </div>
      ) : null}
      {job?.error ? <p role="alert">{job.error}</p> : null}
      {job === null && id ? <p>候補の保存期間が終了しました。</p> : null}
      {result ? (
        <FindingList label={`${result.provider} の候補（要確認）`} findings={result.candidates} />
      ) : null}
    </details>
  );
}
