import { api } from "@mf100/convex/api";
import { FEEDBACK_TITLE_MAX } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Field, Select, TextInput } from "@/ui/Field";
import { M3eButton, M3eDialog } from "@/ui/m3e";
import { FeedbackComposer } from "./FeedbackComposer";

/**
 * スレッドを立てる（全画面のダイアログ）。制作物・話題（題名）・最初の投稿（テンプレ・添付つき）。
 * 制作物はふだん関わっている制作物から選ぶ（エディタから来たときはその制作物で決まっている）。
 */
export function NewThreadDialog({
  open,
  onClose,
  workId: fixedWorkId,
}: {
  open: boolean;
  onClose: () => void;
  workId?: string;
}) {
  const navigate = useNavigate();
  const create = useMutation(api.feedback.createThread);
  const works = useQuery(api.works.listMine, open && !fixedWorkId ? {} : "skip");
  const [workId, setWorkId] = useState(fixedWorkId ?? "");
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open) {
      setWorkId(fixedWorkId ?? "");
      setTitle("");
    }
  }, [open, fixedWorkId]);

  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">スレッドを立てる</span>
      <div className="dialog-body">
        {fixedWorkId ? null : (
          <Field label="制作物" required>
            <Select value={workId} onChange={(e) => setWorkId(e.target.value)}>
              <option value="">選んでください</option>
              {(works ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="話題" required hint="例: 配色の方向性、キャッチコピーの案">
          <TextInput
            required
            maxLength={FEEDBACK_TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        {workId ? (
          <FeedbackComposer
            key={workId}
            workId={workId}
            label="最初の投稿"
            placeholder="何のために誰に向けて作っているか、この案の意図、迷っている点など（「テンプレ」から書き出しを入れられます）"
            submitLabel="スレッドを立てる"
            extraValid={title.trim() !== ""}
            onSubmit={async (r) => {
              const threadId = await create({
                workId: workId,
                title: title.trim(),
                body: r.body,
                mentions: r.mentions,
                fileIds: r.fileIds,
                ...(r.template ? { template: r.template } : {}),
              });
              onClose();
              void navigate({ to: "/feedback/$threadId", params: { threadId } });
            }}
          />
        ) : (
          <p className="muted small">制作物を選ぶと、最初の投稿を書けます</p>
        )}
      </div>
      <div slot="actions" className="row">
        <span className="spacer" />
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
