import { useAction } from "@/lib/useAction";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eLinearProgressIndicator } from "@m3e/react/progress-indicator";
import type { useAutoProofread } from "./useAutoProofread";

/**
 * 自動校正の状態（コメント欄の先頭）。M3E の進捗表示とボタンだけで組む。
 * 終わったら件数だけを短く出し、失敗は理由と再試行を出す。
 */
export function AutoProofreadStatus({ auto }: { auto: ReturnType<typeof useAutoProofread> }) {
  const retry = useAction(async () => {
    await auto.retry?.();
  });
  const run = auto.run;
  if (!run || run.status === "skipped") return null;
  const total = run.artifacts.filter((a) => a.status !== "skipped").length;
  const done = run.artifacts.filter((a) => a.status === "done").length;
  const findings = run.artifacts.reduce((n, a) => n + a.findings, 0);
  const failed = run.artifacts.filter((a) => a.status === "failed");
  const working = run.status === "pending" || run.status === "running";
  return (
    <div className="auto-status" role="status" aria-live="polite">
      <div className="auto-status__row">
        <M3eIcon name="smart_toy" className="auto-status__icon" aria-hidden="true" />
        <span className="small">
          {working
            ? (auto.progress?.label ??
              (auto.canRun
                ? "自動校正を準備しています"
                : "自動校正を待っています（提出者などの端末で検査します）"))
            : run.status === "failed"
              ? `自動校正に失敗したファイルがあります（${failed.length} 件）`
              : `自動校正: 表記のコメント ${findings} 件`}
        </span>
        <span className="spacer" />
        {run.status === "failed" && auto.canRun ? (
          <M3eButton variant="text" disabled={retry.pending} onClick={() => void retry.run()}>
            再試行
          </M3eButton>
        ) : null}
      </div>
      {working ? (
        <M3eLinearProgressIndicator
          {...(auto.progress
            ? { mode: "indeterminate" as const }
            : { value: total ? (done / total) * 100 : 0 })}
          aria-label="自動校正の進み具合"
        />
      ) : null}
      {failed.map((a) => (
        <p key={a.artifactId} className="small error-text">
          {a.error}
        </p>
      ))}
    </div>
  );
}
