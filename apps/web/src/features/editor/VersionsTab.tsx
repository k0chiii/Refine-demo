import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { formatDeadlineUntil, formatJstShort } from "@/lib/format";
import { closedReasonLabel, reviewStateLabel } from "@/lib/labels";
import { useAction } from "@/lib/useAction";
import { StatusText } from "@/ui/Chip";
import { Field, TextArea } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";

export type WorkData = FunctionReturnType<typeof api.works.get>;

/**
 * エディタの引き出し「版」: 履歴、この版を開く、新しい版を提出、誤提出の無効化。
 * 版を比べる入口はアプリバーの「比べる」（features/compare/CompareButton。利用者指示 2026-10-17）。ここには置かない。
 */
export function VersionsTab({
  work,
  currentId,
  canVoid,
  onOpen,
  onSubmit,
  onWrite,
}: {
  work: WorkData;
  currentId: string | null;
  canVoid: boolean;
  onOpen: (r: WorkData["revisions"][number]) => void;
  onSubmit: () => void;
  /** 文章エディタを開く（下書きを書いて版として提出する） */
  onWrite: () => void;
}) {
  const voidRevision = useMutation(api.submissions.voidRevision);
  const [voidDraft, setVoidDraft] = useState<string | null>(null);
  const doVoid = useAction(async () => {
    if (voidDraft === null || !currentId) return;
    await voidRevision({ revisionId: currentId as Id<"revisions">, reason: voidDraft });
    setVoidDraft(null);
  });
  const current = work.revisions.find((r) => r.id === currentId) ?? null;
  const active = work.work.lifecycle === "active";

  return (
    <div className="versions">
      {work.can.submit && active ? (
        <div className="row versions__actions">
          <M3eButton variant="filled" className="versions__submit" onClick={onSubmit}>
            <M3eIcon slot="icon" name="upload_file" />
            新しい版を提出
          </M3eButton>
          <M3eButton variant="tonal" onClick={onWrite}>
            <M3eIcon
              slot="icon"
              name={work.work.mediaType === "sns" ? "post_add" : "edit_document"}
            />
            {work.work.mediaType === "sns" ? "投稿を作る" : "文章を書く"}
          </M3eButton>
        </div>
      ) : null}
      {work.revisions.length === 0 ? (
        <p className="muted small">まだ版がありません</p>
      ) : (
        <ul className="versions__list">
          {work.revisions.map((r) => {
            const isCurrent = r.id === currentId;
            return (
              <li
                key={r.id}
                className={`version ${isCurrent ? "version--current" : ""} ${r.reviewState === "void" ? "version--void" : ""}`}
              >
                <div className="version__head">
                  <span className="version__label">
                    {r.label}
                    {work.work.finalRevisionId === r.id ? (
                      <StatusText tone="success" className="ml">
                        校了版
                      </StatusText>
                    ) : null}
                  </span>
                  <span className="spacer" />
                  {isCurrent ? (
                    <span className="meta">表示中</span>
                  ) : r.reviewState !== "void" ? (
                    <M3eButton variant="text" onClick={() => onOpen(r)}>
                      開く
                    </M3eButton>
                  ) : null}
                </div>
                <div className="small muted">
                  {r.reviewState === "open"
                    ? `校正中・締切 ${formatDeadlineUntil(r.deadlineAt)}`
                    : r.reviewState === "void"
                      ? reviewStateLabel.void
                      : (closedReasonLabel[r.reviewClosedReason ?? ""] ?? "受付終了")}
                  ・{r.submitter?.name}・{formatJstShort(r.submittedAt)}
                  {r.unresolvedCount > 0 ? `・未対応 ${r.unresolvedCount}` : ""}
                  {r.pendingChecks.length > 0 ? `・専門確認 ${r.pendingChecks.length}` : ""}
                </div>
                {r.changeSummary ? <div className="small">{r.changeSummary}</div> : null}
                {r.focusNotes ? (
                  <div className="small muted">見てほしい観点: {r.focusNotes}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {current && canVoid ? (
        <M3eButton variant="text" className="versions__void" onClick={() => setVoidDraft("")}>
          この版を無効化
        </M3eButton>
      ) : null}

      <M3eDialog open={voidDraft !== null} onClosed={() => setVoidDraft(null)} closeLabel="閉じる">
        <span slot="header">この版を無効にする</span>
        <div className="dialog-body">
          <p className="small muted" style={{ margin: 0 }}>
            {current?.label} を無効にします。版番号は欠番になります
          </p>
          <Field label="理由" required>
            <TextArea
              required
              value={voidDraft ?? ""}
              onChange={(e) => setVoidDraft(e.target.value)}
              placeholder="例: 別の制作物のファイルを提出した"
            />
          </Field>
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setVoidDraft(null)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doVoid.pending || !voidDraft?.trim()}
            onClick={() => void doVoid.run()}
          >
            無効化する
          </M3eButton>
        </div>
      </M3eDialog>
    </div>
  );
}
