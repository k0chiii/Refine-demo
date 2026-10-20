import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import { COMMENT_FILES_MAX, COMMENT_FILE_MAX_BYTES, commentFileType } from "@mf100/domain";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { guessMimeType } from "@/features/upload/fileKind";
import { uploadCommentFile } from "@/integrations/api";
import { nameForPasted } from "@/lib/attachmentCompress.core";
import {
  createLimiter,
  dragHasFiles,
  filesFromClipboard,
  overallProgress,
  planAdd,
} from "@/lib/attachmentQueue";
import { describeError, messageForCode } from "@/lib/errors";
import { toast } from "@/lib/toast";

/**
 * コメント・返信に添付するファイルの用意と送信（選ぶ・貼る・落とす → 圧縮 → 準備 → 送信 → 検証済みの fileIds）。
 * 投稿欄に配線して使う（画面は配線しない段階）。送信は投稿とは別に、添付した時点で始まる:
 *
 *   const uploads = useCommentFileUploads({ revisionId, purpose: "comment" });
 *   <textarea {...uploads.bind} />                  // 貼り付け・ドロップ
 *   <input type="file" multiple onChange={(e) => uploads.add(e.target.files)} />
 *   <PendingCommentFiles uploads={uploads} />        // 並んだ添付と進み具合
 *   await postComment({ ..., fileIds: uploads.fileIds });  // busy の間は投稿させない
 *   uploads.reset();
 *
 * - 画像は縮めて WebP/AVIF にし（lib/attachmentCompress）、サムネイルも作って一緒に送る。PDF・文書はそのまま。
 * - 送信は同時に 3 件まで。進み具合は実際に送れた量。
 * - 取り除いた添付・コンポーネントが消えたときの送信は止める（準備済みで付けなかった添付は 24 時間後にサーバーが片付ける）。
 */

export type AttachmentPhase = "compressing" | "preparing" | "uploading" | "done" | "error";

export interface AttachmentItem {
  /** この画面での識別子 */
  key: string;
  /** 利用者が選んだ名前・大きさ（圧縮前） */
  name: string;
  size: number;
  type: ReturnType<typeof commentFileType>;
  phase: AttachmentPhase;
  /** 0〜1。圧縮・準備の間は 0、送信の間は実際に送れた量、済んだら 1 */
  progress: number;
  /** 画像の一覧用の絵（サムネイル、無ければ画像そのもの）。object URL（取り除く・消えるときに破棄する） */
  previewUrl: string | null;
  width?: number;
  height?: number;
  /** 圧縮後の送る大きさ（圧縮が済んでから） */
  sentSize?: number;
  /** 検証済みになったときの添付 ID */
  fileId?: string;
  error?: string;
}

export interface CommentFileUploads {
  items: AttachmentItem[];
  /** 検証済みの添付 ID（添えた順）。投稿の fileIds に渡す */
  fileIds: string[];
  /** 圧縮・準備・送信の途中のものがある（この間は投稿させない） */
  busy: boolean;
  /** 失敗したものがある */
  hasError: boolean;
  /** 上限（10 件）に達している */
  full: boolean;
  /** 全体の進み具合（0〜1） */
  progress: number;
  add(files: Iterable<File> | ArrayLike<File> | null | undefined): void;
  remove(key: string): void;
  retry(key: string): void;
  /** 投稿が済んだ・取りやめたとき。並んでいる添付を片付ける（送信中のものは止める） */
  reset(): void;
  /** 投稿欄に渡す貼り付け・ドロップの受け口 */
  bind: {
    onPaste: (
      e: ClipboardEvent | { clipboardData: DataTransfer | null; preventDefault(): void },
    ) => void;
    onDrop: (e: DragEvent | { dataTransfer: DataTransfer | null; preventDefault(): void }) => void;
    onDragOver: (
      e: DragEvent | { dataTransfer: DataTransfer | null; preventDefault(): void },
    ) => void;
  };
}

/** 送信の並列度（圧縮は Worker の中で 1 枚ずつ） */
const UPLOAD_CONCURRENCY = 3;
const limitUpload = createLimiter(UPLOAD_CONCURRENCY);

interface Runtime {
  file: File;
  abort: AbortController;
  previewUrl: string | null;
}

export function useCommentFileUploads(opts: {
  revisionId: string;
  purpose: "comment" | "reply";
}): CommentFileUploads {
  const token = useAuthToken();
  const prepare = useMutation(api.commentFiles.prepare);
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const runtime = useRef(new Map<string, Runtime>());
  const latest = useRef({ token, prepare, opts, items });
  latest.current = { token, prepare, opts, items };
  const seq = useRef(0);

  const patch = useCallback((key: string, over: Partial<AttachmentItem>) => {
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...over } : i)));
  }, []);

  const discard = useCallback((key: string) => {
    const rt = runtime.current.get(key);
    if (!rt) return;
    rt.abort.abort();
    if (rt.previewUrl) URL.revokeObjectURL(rt.previewUrl);
    runtime.current.delete(key);
  }, []);

  const start = useCallback(
    async (key: string) => {
      const rt = runtime.current.get(key);
      if (!rt) return;
      // この試行の信号（やり直しで差し替わっても、古い試行は止まったままにする）
      const signal = rt.abort.signal;
      const live = () => runtime.current.get(key) === rt && !signal.aborted;
      try {
        patch(key, { phase: "compressing", progress: 0, error: "" });
        const { prepareAttachment } = await import("@/lib/attachmentCompress");
        const prepared = await prepareAttachment(rt.file);
        if (!live()) return;
        if (prepared.file.size > COMMENT_FILE_MAX_BYTES)
          throw new Error(messageForCode("upload_file_too_large"));
        // 画像の絵: サムネイル、無ければ送る画像そのもの（画像でないものは出さない）
        const preview =
          prepared.thumb ?? (prepared.file.type.startsWith("image/") ? prepared.file : null);
        if (preview && !rt.previewUrl) {
          rt.previewUrl = URL.createObjectURL(preview);
          patch(key, { previewUrl: rt.previewUrl });
        }
        patch(key, {
          sentSize: prepared.file.size,
          ...(prepared.width !== undefined && prepared.height !== undefined
            ? { width: prepared.width, height: prepared.height }
            : {}),
        });

        patch(key, { phase: "preparing" });
        const { prepare: prepareFiles, opts: o } = latest.current;
        const [reserved] = await prepareFiles({
          revisionId: o.revisionId,
          purpose: o.purpose,
          files: [
            {
              fileName: prepared.file.name,
              originalName: prepared.originalName,
              mimeType: guessMimeType(prepared.file.name, prepared.file.type),
              size: prepared.file.size,
              originalSize: prepared.originalSize,
              ...(prepared.width !== undefined && prepared.height !== undefined
                ? { width: prepared.width, height: prepared.height }
                : {}),
            },
          ],
        });
        if (!live()) return;
        const fileId = reserved!.fileId;

        patch(key, { phase: "uploading", progress: 0, fileId });
        const result = await limitUpload(() => {
          const t = latest.current.token;
          if (!t) throw new Error("サインインし直してください");
          if (!live()) throw new DOMException("aborted", "AbortError");
          return uploadCommentFile(t, fileId, prepared.file, {
            thumb: prepared.thumb,
            signal,
            onProgress: (fraction) => {
              if (live()) patch(key, { progress: fraction });
            },
          });
        });
        if (!live()) return;
        if (result.status !== "verified")
          throw new Error(result.failureMessage ?? `${rt.file.name} を送れませんでした`);
        patch(key, { phase: "done", progress: 1 });
      } catch (e) {
        if (!live() || (e instanceof DOMException && e.name === "AbortError")) return;
        const message = describeError(e).message;
        patch(key, { phase: "error", error: message });
        toast(message, { kind: "error" });
      }
    },
    [patch],
  );

  const add = useCallback<CommentFileUploads["add"]>(
    (list) => {
      if (!list) return;
      const picked = Array.from(list as ArrayLike<File>);
      if (picked.length === 0) return;
      const plan = planAdd(
        latest.current.items.map((i) => ({ name: i.name, size: i.size })),
        picked.map((f) => ({ file: f, name: f.name, size: f.size })),
        COMMENT_FILES_MAX,
      );
      if (plan.overflow > 0)
        toast(`添付は 1 つのコメントに ${COMMENT_FILES_MAX} 件までです`, { kind: "warning" });
      const added: AttachmentItem[] = [];
      for (const entry of plan.accepted) {
        const key = `att${++seq.current}`;
        runtime.current.set(key, {
          file: entry.file,
          abort: new AbortController(),
          previewUrl: null,
        });
        added.push({
          key,
          name: entry.name,
          size: entry.size,
          type: commentFileType(guessMimeType(entry.name, entry.file.type), entry.name),
          phase: "compressing",
          progress: 0,
          previewUrl: null,
        });
      }
      if (added.length === 0) return;
      setItems((cur) => [...cur, ...added]);
      for (const item of added) void start(item.key);
    },
    [start],
  );

  const remove = useCallback(
    (key: string) => {
      discard(key);
      setItems((cur) => cur.filter((i) => i.key !== key));
    },
    [discard],
  );

  const retry = useCallback(
    (key: string) => {
      const rt = runtime.current.get(key);
      if (!rt) return;
      // 止めた試行の信号は使い回さない
      rt.abort.abort();
      rt.abort = new AbortController();
      void start(key);
    },
    [start],
  );

  const reset = useCallback(() => {
    for (const key of runtime.current.keys()) discard(key);
    setItems([]);
  }, [discard]);

  // コンポーネントが消えるとき、送信を止めて絵を破棄する
  useEffect(() => {
    const map = runtime.current;
    return () => {
      for (const rt of map.values()) {
        rt.abort.abort();
        if (rt.previewUrl) URL.revokeObjectURL(rt.previewUrl);
      }
      map.clear();
    };
  }, []);

  const bind = useMemo<CommentFileUploads["bind"]>(
    () => ({
      onPaste(e) {
        const files = filesFromClipboard({
          files: e.clipboardData?.files ?? null,
          getData: (type) => e.clipboardData?.getData(type) ?? "",
        });
        if (files.length === 0) return;
        e.preventDefault();
        const now = new Date();
        add(files.map((f) => new File([f], nameForPasted(f, now), { type: f.type })));
      },
      onDrop(e) {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        add(files);
      },
      onDragOver(e) {
        // ファイルのときだけ落とす先として受ける（文字のドラッグは今までどおり）
        if (dragHasFiles(e.dataTransfer?.types)) e.preventDefault();
      },
    }),
    [add],
  );

  const fileIds = useMemo(
    () => items.flatMap((i) => (i.phase === "done" && i.fileId ? [i.fileId] : [])),
    [items],
  );
  return {
    items,
    fileIds,
    busy: items.some(
      (i) => i.phase === "compressing" || i.phase === "preparing" || i.phase === "uploading",
    ),
    hasError: items.some((i) => i.phase === "error"),
    full: items.length >= COMMENT_FILES_MAX,
    progress: overallProgress(items),
    add,
    remove,
    retry,
    reset,
    bind,
  };
}
