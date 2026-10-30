import { api } from "@mf100/convex/api";
import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { fetchArtifactBlob } from "@/integrations/api";
import {
  documentSegments,
  imageSegments,
  pdfOcrSegments,
  pdfSegments,
  type ArtifactRef,
} from "./extract";
import { failureText } from "./failureText";

export interface AutoProofreadProgress {
  artifactId: string;
  label: string;
}

/**
 * 提出時の自動校正をこの端末で進める（待ち状態の添付を 1 件ずつ担当して処理する）。
 * 提出者が画面を閉じても、次に開いた人（指摘・提出できる人）の端末で続きから進む。
 * 失敗しても提出は取り消さない。理由を記録し、利用者が再試行できる。
 */
export function useAutoProofread(revisionId: string | null, artifacts: readonly ArtifactRef[]) {
  const view = useQuery(api.proofreading.run, revisionId ? { revisionId } : "skip");
  const claim = useMutation(api.proofreading.claim);
  const submit = useMutation(api.proofreading.submit);
  const fail = useMutation(api.proofreading.fail);
  const retry = useMutation(api.proofreading.retry);
  const token = useAuthToken();
  const [progress, setProgress] = useState<AutoProofreadProgress | null>(null);
  const busy = useRef(false);
  /** 1 件終わるたびに増やし、次の待ちの添付を拾い直す（処理中に状態が変わっても取りこぼさない） */
  const [tick, setTick] = useState(0);

  const run = view?.run ?? null;
  const pending = run?.artifacts.find(
    (a) => a.status === "pending" || (a.status === "running" && (a.leaseUntil ?? 0) < Date.now()),
  );
  useEffect(() => {
    if (!view?.canRun || !run || !pending || !token || busy.current) return;
    const artifact = artifacts.find((a) => a.id === pending.artifactId);
    if (!artifact) return;
    busy.current = true;
    const work = async () => {
      const { claimed } = await claim({ runId: run.id, artifactId: artifact.id });
      if (!claimed) return;
      const name = artifact.fileName;
      try {
        setProgress({ artifactId: artifact.id, label: `${name} を読み込んでいます` });
        const blob = await fetchArtifactBlob(token, artifact.id);
        let segments;
        if (artifact.type === "document") segments = await documentSegments(artifact, blob);
        else if (artifact.type === "pdf") {
          const r = await pdfSegments(blob, (d, t) =>
            setProgress({
              artifactId: artifact.id,
              label: `${name} の文字を取り出しています（${d}/${t} ページ）`,
            }),
          );
          segments = r.segments;
          // 文字の無いページ（スキャン）は OCR で読む
          if (r.textless.length)
            segments = [
              ...segments,
              ...(await pdfOcrSegments(blob, r.textless, (d, t) =>
                setProgress({
                  artifactId: artifact.id,
                  label: `${name} の文字の無いページを画像から読み取っています（${d}/${t}）`,
                }),
              )),
            ];
        } else {
          segments = await imageSegments(blob, (p) =>
            setProgress({
              artifactId: artifact.id,
              label: `${name} の文字を画像から読み取っています（${Math.round(p * 100)}%）`,
            }),
          );
        }
        setProgress({ artifactId: artifact.id, label: `${name} を表記ルールで照合しています` });
        // 大きな PDF は数回に分けて送る（1 回の mutation を軽く保つ）
        const CHUNK = 40;
        if (segments.length <= CHUNK)
          await submit({ runId: run.id, artifactId: artifact.id, segments });
        else {
          // 分割送信: 最後の 1 回で完了になるので、それまでは同じ添付を担当したまま送る
          for (let i = 0; i < segments.length; i += CHUNK) {
            const last = i + CHUNK >= segments.length;
            if (last)
              await submit({ runId: run.id, artifactId: artifact.id, segments: segments.slice(i) });
            else
              await submit({
                runId: run.id,
                artifactId: artifact.id,
                segments: segments.slice(i, i + CHUNK),
                partial: true,
              });
          }
        }
      } catch (e) {
        console.error("[auto-proofread]", artifact.id, e);
        await fail({
          runId: run.id,
          artifactId: artifact.id,
          error: failureText(e),
        }).catch(() => undefined);
      }
    };
    void work().finally(() => {
      busy.current = false;
      setProgress(null);
      setTick((n) => n + 1);
    });
  }, [view?.canRun, run?.id, pending?.artifactId, pending?.status, token, tick]);

  return {
    run,
    canRun: view?.canRun ?? false,
    progress,
    retry: run ? () => retry({ runId: run.id }) : null,
  };
}
