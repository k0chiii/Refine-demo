import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { FEEDBACK_FILES_MAX, feedbackTemplates, type FeedbackTemplateId } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { useId, useRef, useState } from "react";
import { guessArtifactType, guessMimeType } from "@/features/upload/fileKind";
import { activeMentions, MentionProvider, MentionTextarea } from "@/features/review/mentions";
import { uploadFeedbackFile } from "@/integrations/api";
import { formatBytes } from "@/lib/format";
import { toast } from "@/lib/toast";
import { describeError } from "@/lib/errors";
import { M3eButton, M3eIcon, M3eIconButton, M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@/ui/m3e";

export interface ComposerResult {
  body: string;
  mentions: string[];
  fileIds: string[];
  template?: FeedbackTemplateId;
}

/**
 * FB スレッドの投稿欄（新しいスレッドの最初の投稿と返信で共通）。
 * - 本文は @ でメンション（その制作物の FB でメンションできる人。api.feedback.mentionCandidates）
 * - 「テンプレート」から FB テンプレート（制作者・初回／制作者・版更新／校正er）を書き出しに入れる（利用者の FB 制度案）
 * - 作業中の案（PDF・画像・.ai など）を添付。送るときに R2 へ上げ、検証済みになってから投稿する
 * - Ctrl（⌘）＋Enter で送る
 */
export function FeedbackComposer({
  workId,
  label,
  placeholder,
  submitLabel = "送信",
  onSubmit,
  autoFocus,
  disabled,
  extraValid = true,
}: {
  workId: string;
  label: string;
  placeholder?: string;
  submitLabel?: string;
  /** 投稿する（スレッドを立てる・返信する）。成功したら欄を空にする */
  onSubmit: (r: ComposerResult) => Promise<void>;
  autoFocus?: boolean;
  disabled?: boolean;
  /** 題名などほかの欄が揃っているか */
  extraValid?: boolean;
}) {
  const token = useAuthToken();
  const id = useId().replace(/:/g, "");
  const candidates = useQuery(api.feedback.mentionCandidates, { workId: workId });
  const prepareFiles = useMutation(api.feedback.prepareFiles);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [template, setTemplate] = useState<FeedbackTemplateId | undefined>(undefined);
  const [sending, setSending] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const insertTemplate = (tid: FeedbackTemplateId) => {
    const t = feedbackTemplates.find((x) => x.id === tid);
    if (!t) return;
    setBody((b) => (b.trim() ? `${b.replace(/\s+$/, "")}\n\n${t.body}` : t.body));
    setTemplate(tid);
  };
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    // 入力欄を空にすると FileList も空になるので、先に取り出す
    const picked = Array.from(list);
    setFiles((cur) => {
      const next = [...cur];
      for (const f of picked) if (!next.some((c) => c.name === f.name)) next.push(f);
      if (next.length > FEEDBACK_FILES_MAX)
        toast(`添付は 1 回に ${FEEDBACK_FILES_MAX} 件までです`, { kind: "warning" });
      return next.slice(0, FEEDBACK_FILES_MAX);
    });
    if (fileRef.current) fileRef.current.value = "";
  };
  const canSend = !disabled && !sending && extraValid && (body.trim() !== "" || files.length > 0);

  const send = async () => {
    if (!canSend || !token) return;
    try {
      let fileIds: string[] = [];
      if (files.length) {
        setSending("添付を準備しています…");
        const prepared = await prepareFiles({
          workId: workId,
          files: files.map((f) => ({
            fileName: f.name,
            mimeType: guessMimeType(f.name, f.type),
            size: f.size,
          })),
        });
        fileIds = prepared.map((p) => p.fileId);
        for (let i = 0; i < files.length; i++) {
          setSending(`添付を送っています（${i + 1} / ${files.length}）…`);
          const r = await uploadFeedbackFile(token, fileIds[i]!, files[i]!);
          if (r.status !== "verified")
            throw new Error(r.failureMessage ?? `${files[i]!.name} を送れませんでした`);
        }
      }
      setSending("投稿しています…");
      await onSubmit({
        body: body.trim(),
        mentions: activeMentions(body, mentions, candidates ?? []),
        fileIds,
        ...(template ? { template } : {}),
      });
      setBody("");
      setMentions([]);
      setFiles([]);
      setTemplate(undefined);
    } catch (e) {
      toast(describeError(e).message, { kind: "error" });
    } finally {
      setSending(null);
    }
  };

  return (
    <MentionProvider value={candidates ?? []}>
      <div className="fb-composer">
        <MentionTextarea
          className="fb-composer__input"
          aria-label={label}
          aria-describedby={`${id}-hint`}
          placeholder={placeholder ?? `${label}を書く`}
          rows={2}
          autoFocus={autoFocus}
          value={body}
          onValue={setBody}
          mentions={mentions}
          onMentions={setMentions}
          disabled={disabled || sending !== null}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <p className="fb-composer__hint" id={`${id}-hint`}>
          @ で名前を呼ぶ（メンション）・{isMac ? "⌘" : "Ctrl"}＋Enter で{submitLabel}
        </p>
        {files.length ? (
          <ul className="fb-composer__files" aria-label="添付するファイル">
            {files.map((f) => (
              <li key={f.name} className="fb-file-chip">
                <M3eIcon name={iconFor(guessArtifactType(f.name, f.type))} />
                <span className="fb-file-chip__name">{f.name}</span>
                <span className="muted small">{formatBytes(f.size)}</span>
                <M3eIconButton
                  aria-label={`${f.name} を外す`}
                  disabled={sending !== null}
                  onClick={() => setFiles((cur) => cur.filter((c) => c !== f))}
                >
                  <M3eIcon name="close" />
                </M3eIconButton>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="fb-composer__bar">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
          <M3eIconButton
            aria-label="ファイルを添付"
            title="ファイルを添付（PDF・画像・.ai など）"
            disabled={sending !== null}
            onClick={() => fileRef.current?.click()}
          >
            <M3eIcon name="attach_file" />
          </M3eIconButton>
          <M3eButton variant="text" disabled={sending !== null}>
            <M3eIcon slot="icon" name="article" />
            テンプレート
            <M3eMenuTrigger htmlFor={`${id}-tpl`} />
          </M3eButton>
          <M3eMenu id={`${id}-tpl`} positionY="above">
            {feedbackTemplates.map((t) => (
              <M3eMenuItem key={t.id} onClick={() => insertTemplate(t.id)}>
                <M3eIcon slot="icon" name={t.role === "creator" ? "brush" : "rate_review"} />
                {t.label}
              </M3eMenuItem>
            ))}
          </M3eMenu>
          <span className="spacer" />
          {sending ? (
            <span className="small muted" role="status">
              {sending}
            </span>
          ) : null}
          <M3eButton variant="filled" disabled={!canSend} onClick={() => void send()}>
            <M3eIcon slot="icon" name="send" />
            {submitLabel}
          </M3eButton>
        </div>
      </div>
    </MentionProvider>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const iconFor = (type: string) =>
  type === "pdf"
    ? "picture_as_pdf"
    : type === "image"
      ? "image"
      : type === "document"
        ? "article"
        : "draft";
