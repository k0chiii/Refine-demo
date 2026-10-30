import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  artifactFormatLabel,
  assertGraphicHasReviewableFile,
  assertDeclaredSizeWithinLimit,
  checklistFor,
  checkTypeLabels,
  checkTypes,
  collectFigmaUrls,
  emptyDeclarations,
  isGraphicMediaType,
  isGraphicSubmissionFile,
  isIllustratorFile,
  isReviewableArtifact,
  pickReviewArtifact,
  revisionDeclarationItems,
  suggestedChecksFor,
  type CheckType,
  type MediaType,
  type RevisionDeclarations,
  POST_MANIFEST_NAME,
} from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { figmaStatus, importFigmaFrames, uploadItem } from "@/integrations/api";
import { describeError } from "@/lib/errors";
import { endOfJstDay, formatBytes, formatDeadlineUntil } from "@/lib/format";
import { StatusText } from "@/ui/Chip";
import { DateField } from "@/ui/DateField";
import { Checkbox, Field, Select, TextArea, TextInput } from "@/ui/Field";
import { Loading } from "@/ui/Loading";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eExpansionPanel } from "@m3e/react/expansion-panel";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eList, M3eListItem } from "@m3e/react/list";
import { M3eLinearProgressIndicator } from "@m3e/react/progress-indicator";
import { UserPicker } from "@/ui/UserPicker";
import {
  SubmissionFlow,
  canConfirm,
  failedItems,
  initialState,
  type FlowState,
} from "./submissionFlow";
import { guessArtifactType, guessMimeType, sniffPdfCompatible } from "./fileKind";
import { toast } from "@/lib/toast";

/**
 * 媒体ごとの提出のしかた（利用者指示 2026-10-17「区分に応じて提出画面を分けたい。web ならリンクだけでいい」）。
 * - web: ファイルは無く、サイトの URL だけ（校正者はライブ表示の上でコメントする）
 * - figma: ファイルは無く、フレームの URL だけ（取り込んで画像の添付にし、URL は外部リンクとしても残す）
 * - pdf・画像（グラフィック制作物。利用者指示 2026-10-19）: PDF・画像・Illustrator（.ai）・InDesign（.indd）を一緒に。
 *   校正は紙面に出せる PDF・画像（PDF 互換の .ai を含む）に付け、.indd などはダウンロード用
 * - 動画: 動画のファイルだけ
 * - 文章・SNS 投稿: ファイル（文章エディタ・投稿の編集が作った下書きを最初から入れて開く）
 * - その他: ファイルと、あれば外部リンク
 */
type SubmitInput =
  | { kind: "web" }
  | { kind: "figma" }
  | {
      kind: "files";
      /** ファイル選択に渡す accept。無ければ制限しない */
      accept?: string;
      /** 「PDF」「画像」「動画」。ファイル欄の案内と、違う種類を置いたときの知らせに使う */
      noun?: string;
      matches?: (f: File) => boolean;
      /** 外部リンク（任意）も受けるか */
      link: boolean;
    };

function submitInputFor(mediaType: MediaType | undefined): SubmitInput {
  switch (mediaType) {
    case "web":
      return { kind: "web" };
    case "figma":
      return { kind: "figma" };
    case "pdf":
    case "image":
      return {
        kind: "files",
        accept: ".pdf,application/pdf,image/*,.ai,.indd",
        noun: "PDF・画像・Illustrator（.ai）・InDesign（.indd）",
        matches: (f) => isGraphicSubmissionFile({ fileName: f.name, mimeType: f.type }),
        link: true,
      };
    case "video":
      return {
        kind: "files",
        accept: "video/*,.mov,.m4v,.mp4,.webm",
        noun: "動画",
        matches: (f) => guessArtifactType(f.name, f.type) === "video",
        link: false,
      };
    case "document":
    case "sns":
      return { kind: "files", link: false };
    default:
      return { kind: "files", link: true };
  }
}

/** http(s) の URL か（ライブ表示の iframe に渡せるもの） */
const isHttpUrl = (raw: string) => {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

/**
 * U-04 版提出（ダイアログ。狭い画面では全画面）。制作物の画面を離れずに提出し、確定後はその版の校正画面へ移る。
 * 巨大ファイルは状態と再送可能な範囲を表示する。「確定」が成功するまで旧版の受付は維持される（サーバー保証）。
 */
export function SubmitDialog({
  workId,
  open,
  onClose,
  initialFiles,
}: {
  workId: string;
  open: boolean;
  onClose: () => void;
  /** 文章エディタの「版として提出」: 下書きから作った HTML を最初から入れておく */
  initialFiles?: File[];
}) {
  const navigate = useNavigate();
  const token = useAuthToken();
  const data = useQuery(api.works.get, open ? { workId } : "skip");
  const prepare = useMutation(api.submissions.prepare);
  const reset = useMutation(api.submissions.reset);
  const confirm = useMutation(api.submissions.confirm);

  // 既定は 3 日後の終わり（日付だけの締切＝その日の 23:59 まで）。当日の終わりも選べる
  const defaultDeadline = useMemo(() => endOfJstDay(Date.now() + 3 * 86_400_000), []);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(defaultDeadline);
  const [form, setForm] = useState({
    kind: "standard",
    changeSummary: "",
    focusNotes: "",
    notes: "",
    externalUrl: "",
    /** Figma のフレームの URL（1 行 1 つ。取り込んで画像の添付にし、URL も外部リンクとして残す） */
    figmaUrls: "",
  });
  // Figma 連携（Worker にトークンがあるか）。無ければ URL は外部リンク（埋め込み表示）だけ付く
  const [figmaEnabled, setFigmaEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!open || !token || data?.work.mediaType !== "figma") return;
    let cancelled = false;
    void figmaStatus(token).then((r) => {
      if (!cancelled) setFigmaEnabled(r.enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [open, token, data?.work.mediaType]);
  const figmaFrames = useMemo(() => collectFigmaUrls(form.figmaUrls), [form.figmaUrls]);
  /** 取り込む（画像の添付になる）フレーム: ノード ID のある URL。連携が無ければ取り込まない */
  const figmaImports = figmaEnabled ? figmaFrames.filter((f) => f.ref.nodeId) : [];
  // 初めての版か、版の更新か（説明の項目を FB テンプレに合わせて変える。利用者決定 2026-10-15 A-1）
  const isFirst = !(data?.revisions ?? []).some(
    (r) => r.kind === "standard" && r.reviewState !== "void",
  );
  const [files, setFiles] = useState<File[]>([]);
  // 先頭を見て PDF 互換と分かった .ai（紙面に出せる）。確定する種類は Worker が実体を見て決める（ここは案内と事前の確認）
  const [pdfAi, setPdfAi] = useState<ReadonlySet<File>>(new Set());
  const typeOf = (f: File) => (pdfAi.has(f) ? ("pdf" as const) : guessArtifactType(f.name, f.type));
  // 提出したあと紙面に出るファイル（domain の pickReviewArtifact と同じ選び方。PDF → 画像 → 文章 → 動画。
  // 動画の制作物は動画を先に）
  const graphic = isGraphicMediaType(data?.work.mediaType);
  const picked = pickReviewArtifact(
    files.map((f) => ({ type: typeOf(f), role: "source" as const, fileName: f.name, f })),
    data?.work.mediaType === "video" ? "video" : undefined,
  );
  // グラフィック制作物は、紙面に出せるファイルが無ければ「紙面に表示」のファイルは無い（.indd だけ等。提出前に知らせる）
  const shownFile = picked && (!graphic || isReviewableArtifact(picked)) ? picked.f : null;
  const [dragging, setDragging] = useState(false);
  /** 専門確認（§2.2-4）。種別ごとに要否・担当者を宣言する。校了時に未完了ならブロック（D6）。 */
  const [checks, setChecks] = useState<Record<string, { on: boolean; assignee: string[] }>>(
    Object.fromEntries(checkTypes.map((t) => [t, { on: false, assignee: [] }])),
  );
  /**
   * 提出前の確認と申告（Notion の版 DB のチェックボックスに揃えた。利用者決定 2026-10-17。docs/NOTION_ALIGNMENT.md）。
   * 確認は本人の確認（提出を止めない）。申告（写真・めい・指針外の色の使用）は版に記録し、写真と指針外の色は専門確認を勧める
   */
  const [selfChecks, setSelfChecks] = useState<string[]>([]);
  const [declarations, setDeclarations] = useState<RevisionDeclarations>(emptyDeclarations);
  const checklist = checklistFor(data?.work.genre);
  const declare = (key: keyof RevisionDeclarations, on: boolean) => {
    const next = { ...declarations, [key]: on };
    setDeclarations(next);
    // 写真の使用 → 写真（肖像・権利）、指針外の色 → デザイン の専門確認を付ける（外すのは人が決める）
    if (on)
      setChecks((c) => {
        const out = { ...c };
        for (const t of suggestedChecksFor({ [key]: true })) out[t] = { ...out[t]!, on: true };
        return out;
      });
  };
  const [flow, setFlow] = useState<SubmissionFlow | null>(null);
  /** PNG を可逆に作り直している間（準備の前。ボタンに「圧縮しています」を出す） */
  const [compressing, setCompressing] = useState(false);
  const starting = useRef(false);
  const [state, setState] = useState<FlowState>(initialState);
  // 入力の不足・転送の失敗はスナックバーで知らせる（ダイアログの中に赤い箱を出さない）
  const setError = (m: string | null) => {
    if (m) toast(m, { kind: "error" });
  };

  useEffect(() => (flow ? flow.subscribe(setState) : undefined), [flow]);
  // 転送・確定の失敗、失敗したファイルの件数はスナックバーで（各ファイルの行にも「失敗」と再アップロードが出る）
  useEffect(() => {
    if (state.error) toast(state.error, { kind: "error" });
  }, [state.error]);
  const failed = failedItems(state).length;
  useEffect(() => {
    if (failed > 0)
      toast(`${failed} 件を送れませんでした。再アップロードしてから提出してください`, {
        kind: "error",
      });
  }, [failed]);
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0) setFiles(initialFiles);
  }, [open, initialFiles]);
  useEffect(() => {
    if (!state.confirmed) return;
    const n = state.confirmed.kind === "rough" ? 0 : state.confirmed.sequence;
    onClose();
    void navigate({ to: "/works/$workId/v/$n", params: { workId, n: String(n) } });
  }, [state.confirmed?.revisionId]);

  const work = data?.work ?? null;
  const revisions = data?.revisions ?? [];
  const hasRough = revisions.some((r) => r.kind === "rough");
  const hasStandard = revisions.some((r) => r.kind === "standard");
  const accepting = revisions.find((r) => r.id === data?.acceptingRevisionId) ?? null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  // 文章エディタ・投稿の編集が下書きから作ったファイルを持って開いたときは、媒体に関わらずファイルの提出
  const input: SubmitInput =
    initialFiles && initialFiles.length > 0
      ? { kind: "files", link: false }
      : submitInputFor(work?.mediaType);
  const linkOnly = input.kind === "web" || input.kind === "figma";
  /** 置いたファイルのうち、この制作物の種類（PDF・画像・動画）に合わないものは受けない（選択は accept で絞る） */
  const addFiles = (list: FileList | File[] | null, fromDrop = false) => {
    let next = Array.from(list ?? []);
    if (fromDrop && input.kind === "files" && input.matches) {
      const ok = next.filter(input.matches);
      if (ok.length < next.length) setError(`${input.noun} のファイルだけ出せます`);
      next = ok;
    }
    // 1 ファイルの上限（Worker の本文の上限）。超えるファイルは選んだ時点で理由を知らせて受けない
    next = next.filter((f) => {
      try {
        // ダウンロード専用の原本は gzip して上げられるので、元の大きさは本文の上限の 4 倍まで（圧縮後が上限を超えれば送る前に断る）
        assertDeclaredSizeWithinLimit({
          fileName: f.name,
          mimeType: guessMimeType(f.name, f.type),
          size: f.size,
        });
        return true;
      } catch (error) {
        setError(`${f.name}: ${describeError(error).message}`);
        return false;
      }
    });
    if (next.length === 0) return;
    const added = next.filter((f) => !files.some((c) => c.name === f.name));
    setFiles((cur) => [...cur, ...next.filter((f) => !cur.some((c) => c.name === f.name))]);
    // .ai は先頭を見て、PDF 互換なら紙面に出せるファイルとして案内する
    for (const f of added.filter((f) => isIllustratorFile(f.name)))
      void sniffPdfCompatible(f).then((ok) => {
        if (ok) setPdfAi((cur) => new Set(cur).add(f));
      });
  };

  const start = async () => {
    setError(null);
    if (!work) return;
    if (!deadlineAt) return setError("校正期限を入力してください");
    if (deadlineAt <= Date.now())
      return setError("校正期限が過ぎています。今より後の日時にしてください");
    if (!token)
      return setError("サインインの有効期限が切れました。もう一度サインインしてください。");
    if (input.kind === "web" && !isHttpUrl(form.externalUrl))
      return setError("サイトの URL を https:// から入れてください");
    if (input.kind === "figma" && figmaFrames.length === 0)
      return setError("Figma のフレームの URL を入れてください");
    if (
      input.kind === "files" &&
      graphic &&
      form.externalUrl.trim() &&
      !isHttpUrl(form.externalUrl)
    )
      return setError("スライドのリンクは https:// から入れてください");
    // グラフィック制作物は、紙面に出して校正できるファイル（PDF・画像・PDF 互換の .ai）が要る。転送の前に知らせる
    // （サーバーも確定のときに同じ規則で断る）
    if (input.kind === "files" && graphic) {
      try {
        assertGraphicHasReviewableFile(
          work.mediaType,
          files.map((f) => ({ type: typeOf(f), role: "source" as const, fileName: f.name })),
        );
      } catch (error) {
        return setError(describeError(error).message);
      }
    }
    // PNG は画素が 1 つも変わらない形に作り直してから準備する（申告する大きさも作り直した後のもの）。
    // 時間がかかる・得が小さい・確かめられないときは元のファイル。ダウンロード専用の原本の gzip は転送のときに行う
    if (starting.current) return;
    starting.current = true;
    let sendFiles = files;
    try {
      if (input.kind === "files" && files.length > 0) {
        const { optimiseFilesForUpload } = await import("@/lib/uploadOptimise");
        sendFiles = await optimiseFilesForUpload(files, { onStart: () => setCompressing(true) });
      }
    } catch {
      sendFiles = files;
    } finally {
      setCompressing(false);
      starting.current = false;
    }
    const items = [
      ...sendFiles.map((f) => ({
        fileName: f.name,
        mimeType: guessMimeType(f.name, f.type),
        type: typeOf(f),
        role: "source" as const,
        declaredSize: f.size,
      })),
      // Figma のフレーム（ファイルの次に並べる。SubmissionFlow がこの順を前提にする）。名前は取り込みでノード名になる
      ...figmaImports.map((f) => ({
        fileName: `figma-${f.ref.nodeId!.replace(":", "-")}.png`,
        mimeType: "image/png",
        type: "image" as const,
        role: "source" as const,
        origin: {
          kind: "figma" as const,
          fileKey: f.ref.fileKey,
          nodeId: f.ref.nodeId!,
          scale: 2,
          box: { width: 0, height: 0 },
        },
      })),
      // Figma の URL は外部リンクとしても残す（埋め込み表示・フレーム単位のコメント・「Figma で開く」）
      ...figmaFrames.map((f) => ({
        fileName: f.url,
        mimeType: "text/uri-list",
        type: "external_link" as const,
        role: "external" as const,
        externalUrl: f.url,
      })),
      ...(form.externalUrl.trim() &&
      (input.kind === "web" || (input.kind === "files" && input.link))
        ? [
            {
              fileName: form.externalUrl.trim(),
              mimeType: "text/uri-list",
              type: "external_link" as const,
              role: "external" as const,
              externalUrl: form.externalUrl.trim(),
            },
          ]
        : []),
    ];
    const requiredChecks = checkTypes
      .filter((t) => checks[t]?.on)
      .map((t) => ({
        type: t as CheckType,
        label: checkTypeLabels[t],
        ...(checks[t]?.assignee[0] ? { assigneeId: checks[t]!.assignee[0]! } : {}),
      }));
    // SNS 投稿の版: 添付する内容の記録と同じものを渡し、サーバーで添付との対応を確かめる
    const manifest = files.find((x) => x.name === POST_MANIFEST_NAME);
    const postSnapshot = manifest ? await manifest.text() : undefined;
    const requestId = crypto.randomUUID();
    const f = new SubmissionFlow(
      {
        prepare: () =>
          prepare({
            workId: work.id as Id<"works">,
            kind: form.kind as "standard",
            reviewType: "general",
            deadlineAt,
            // 初回の「補足」は版の説明（changeSummary）の後ろに添える（データの持ち方は変えない）
            changeSummary:
              isFirst && form.notes.trim()
                ? `${form.changeSummary.trim()}\n\n【補足】\n${form.notes.trim()}`.trim()
                : form.changeSummary,
            focusNotes: form.focusNotes,
            items,
            ...(requiredChecks.length > 0 ? { requiredChecks } : {}),
            ...(postSnapshot !== undefined ? { postSnapshot } : {}),
            declarations,
            ...(selfChecks.length > 0 ? { selfChecks } : {}),
            requestId,
          }).then((r) => ({ sessionId: r.sessionId, items: r.items })),
        upload: (itemId, file, onProgress, onPhase) =>
          uploadItem(token, itemId, file, onProgress, onPhase),
        ...(figmaEnabled ? { importFigma: (its) => importFigmaFrames(token, its) } : {}),
        reset: (itemId) => reset({ itemId: itemId as Id<"uploadItems"> }).then(() => undefined),
        confirm: (sessionId, rid) =>
          confirm({
            sessionId: sessionId as Id<"uploadSessions">,
            requestId: rid,
            expectedWorkVersion: work.version,
          }),
        randomId: () => crypto.randomUUID(),
      },
      sendFiles,
      figmaImports.map((f) => ({ fileKey: f.ref.fileKey, nodeId: f.ref.nodeId! })),
    );
    setFlow(f);
    try {
      await f.start();
      // リンクだけの提出（Web・Figma）は転送する実体が無い。取り込みまで済んだらそのまま確定する（失敗が残れば止まって再試行）
      if (linkOnly && canConfirm(f.state)) await f.confirm().catch(() => undefined);
    } catch (err) {
      setError(describeError(err).message);
    }
  };

  const requiredCount = checkTypes.filter((t) => checks[t]?.on).length;
  const primaryLabel = linkOnly ? "提出する" : "アップロードを開始";
  const startDisabled =
    compressing ||
    !work ||
    (input.kind === "web"
      ? !form.externalUrl.trim()
      : input.kind === "figma"
        ? figmaFrames.length === 0
        : files.length === 0 && !(input.link && form.externalUrl.trim()));

  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="dialog--full">
      <span slot="header">版を提出</span>
      <div className="dialog-body submit">
        {accepting ? (
          <p className="muted small" style={{ margin: 0 }}>
            {`提出すると ${accepting.label} の校正は締め切られます`}
          </p>
        ) : null}
        {!work ? (
          // 媒体が分かるまで、別の入力欄を出して差し替えない
          <Loading label="読み込んでいます" />
        ) : !flow ? (
          <>
            {input.kind === "web" ? (
              <Field label="サイトの URL" required>
                <TextInput
                  type="url"
                  value={form.externalUrl}
                  onChange={set("externalUrl")}
                  placeholder="https://"
                />
              </Field>
            ) : input.kind === "figma" ? (
              <>
                {/* Figma（docs/FIGMA_WEB_PROOFING.md FG-05）: フレームの URL を貼ると、Worker が Figma から PNG を書き出して
                    画像の添付にする（位置コメントは画像の上）。連携が無いとき・ノード ID の無い URL は外部リンク
                    （埋め込み表示とフレーム単位のコメント）だけ */}
                <Field
                  label="Figma のフレームの URL（1 行に 1 つ）"
                  required
                  hint={
                    figmaEnabled === false
                      ? "Figma 連携が未設定なので、リンクとして付けます"
                      : "フレームのリンクを貼ってください。画像として取り込みます"
                  }
                >
                  <TextArea
                    value={form.figmaUrls}
                    onChange={set("figmaUrls")}
                    placeholder="https://www.figma.com/design/…?node-id=1-2"
                    rows={3}
                  />
                </Field>
                {figmaFrames.length > 0 ? (
                  <p className="small muted" style={{ margin: 0 }}>
                    {figmaFrames.length} 件の URL
                    {figmaImports.length > 0
                      ? `・${figmaImports.length} 件を画像として取り込みます`
                      : ""}
                    {figmaFrames.some((f) => !f.ref.nodeId)
                      ? "・ノード ID の無い URL はファイル全体の埋め込み表示だけです"
                      : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <div
                className={`file-drop ${dragging ? "file-drop--over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  addFiles(e.dataTransfer.files, true);
                }}
              >
                <M3eIcon name="upload_file" />
                <span>
                  {input.noun ? `${input.noun} をここに置くか、` : "ここにファイルを置くか、"}
                </span>
                <label className="file-drop__pick">
                  選択
                  <input
                    type="file"
                    multiple
                    {...(input.accept ? { accept: input.accept } : {})}
                    aria-label="ファイルを選択"
                    onChange={(e) => addFiles(e.target.files)}
                  />
                </label>
                {files.length > 0 ? (
                  <ul className="file-drop__files">
                    {files.map((f) => (
                      <li key={f.name}>
                        {f.name}
                        <span className="muted">
                          　{formatBytes(f.size)}・
                          {f === shownFile
                            ? "プレビューに表示（コメントはこのファイルに）"
                            : `${artifactFormatLabel({ type: typeOf(f), fileName: f.name })}（ダウンロード用）`}
                        </span>
                        <M3eIconButton
                          className="file-drop__remove"
                          aria-label={`${f.name} を外す`}
                          onClick={() => setFiles((cur) => cur.filter((c) => c !== f))}
                        >
                          <M3eIcon name="close" />
                        </M3eIconButton>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {files.length > 0 && graphic && !shownFile ? (
                  <p className="small muted" style={{ margin: 0 }}>
                    .ai・.indd はプレビューできません。PDF か画像も付けてください
                  </p>
                ) : null}
                {input.kind === "files" && input.link && graphic ? (
                  <Field
                    label="Google スライドなどのリンク"
                    hint="PDF とセットで提出するときは、スライドの共有リンクを貼ってください。校正者は PDF 上でコメントし、スライドは外部リンクから開けます"
                  >
                    <TextInput
                      type="url"
                      value={form.externalUrl}
                      onChange={set("externalUrl")}
                      placeholder="https://docs.google.com/presentation/d/…"
                    />
                  </Field>
                ) : null}
              </div>
            )}
            <div className="form">
              <Field label="版の種別" required>
                <Select value={form.kind} onChange={set("kind")}>
                  <option value="standard">
                    通常版（第{revisions.filter((r) => r.kind === "standard").length + 1}版）
                  </option>
                  <option value="rough" disabled={hasStandard}>
                    0版（ラフ）{hasStandard ? "・最初の版だけ" : hasRough ? "・再提出" : ""}
                  </option>
                </Select>
              </Field>
              <DateField
                label="校正期限"
                required
                value={deadlineAt}
                onChange={setDeadlineAt}
                min={Date.now()}
              />
            </div>
            <Field label={isFirst ? "この案の意図" : "変更した点とその理由"}>
              <TextArea
                value={form.changeSummary}
                onChange={set("changeSummary")}
                placeholder={
                  isFirst
                    ? "意識したこと・この表現にした理由など"
                    : "どこを変えたか・なぜ変えたか・この表現にした理由など"
                }
              />
            </Field>
            <Field label={isFirst ? "今回見てほしい点" : "まだ見てほしい点"}>
              <TextArea
                value={form.focusNotes}
                onChange={set("focusNotes")}
                placeholder={
                  isFirst
                    ? "迷っていること・判断したいことなど"
                    : "変更で生まれた新たな迷い・まだ見てほしい点など"
                }
              />
            </Field>
            {/* 提出前の確認（Notion の版 DB のチェックボックス）と申告。文章だけの項目は文章の制作物にだけ出す */}
            <section className="submit-checklist" aria-label="提出前の確認">
              <h3 className="submit-checklist__h">
                提出前の確認
                <span className="muted small">
                  　{selfChecks.length} / {checklist.length}
                </span>
              </h3>
              {checklist.map((c) => (
                <Checkbox
                  key={c.id}
                  id={`self-check-${c.id}`}
                  checked={selfChecks.includes(c.id)}
                  onChange={(on) =>
                    setSelfChecks((cur) => (on ? [...cur, c.id] : cur.filter((x) => x !== c.id)))
                  }
                  label={c.label.replace(/^（文章制作物のみ）/, "")}
                />
              ))}
            </section>
            <section className="submit-checklist" aria-label="この版の申告">
              <h3 className="submit-checklist__h">この版の申告</h3>
              {revisionDeclarationItems.map((it) => (
                <Checkbox
                  key={it.key}
                  id={`declare-${it.key}`}
                  checked={declarations[it.key]}
                  onChange={(on) => declare(it.key, on)}
                  label={it.label}
                />
              ))}
            </section>
            {/* 詳細: 補足（初回）・外部リンク（その他の媒体）・専門確認（§2.2-4。校了時に未完了ならブロック D6） */}
            <M3eExpansionPanel className="expansion checks-details">
              <span slot="header">
                詳細（{isFirst ? "補足・" : ""}専門確認
                {requiredCount > 0 ? ` ${requiredCount} 件` : ""}）
              </span>
              <div className="stack">
                {isFirst ? (
                  <Field label="補足（必要な場合のみ）">
                    <TextArea
                      value={form.notes}
                      onChange={set("notes")}
                      placeholder="リファレンス・未確定や未調整の部分・変更できない条件など"
                    />
                  </Field>
                ) : null}
                {input.kind === "files" && input.link ? (
                  <Field label="外部リンク（任意）">
                    <TextInput
                      type="url"
                      value={form.externalUrl}
                      onChange={set("externalUrl")}
                      placeholder="https://"
                    />
                  </Field>
                ) : null}
                <div className="checks" role="group" aria-label="専門確認を依頼する">
                  {checkTypes.map((t) => (
                    <div key={t} className={`check ${checks[t]?.on ? "" : "check--done"}`}>
                      <Checkbox
                        id={`check-${t}`}
                        checked={checks[t]?.on ?? false}
                        onChange={(on) => setChecks((c) => ({ ...c, [t]: { ...c[t]!, on } }))}
                        label={checkTypeLabels[t]}
                      />
                      <span />
                      {checks[t]?.on ? (
                        <div style={{ minWidth: 240 }}>
                          <UserPicker
                            label="担当者（任意）"
                            single
                            value={checks[t]?.assignee ?? []}
                            onChange={(ids) =>
                              setChecks((c) => ({ ...c, [t]: { ...c[t]!, assignee: ids } }))
                            }
                          />
                        </div>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </M3eExpansionPanel>
          </>
        ) : (
          <div className="stack">
            {/* 転送のようす: 2 行のリスト（ファイル名 / 大きさ・転送の進み・失敗の理由）と、末尾に状態（確認済みはチェック）。監査 D-04 */}
            <M3eList className="list upload-list" aria-label="アップロード">
              {state.items.map((it) => (
                <M3eListItem key={it.itemId} className="list__item upload-item">
                  <M3eIcon slot="leading" name="draft" />
                  <span className="list__headline">{it.fileName}</span>
                  <span slot="supporting-text">
                    {it.file ? formatBytes(it.file.size) : "\u00A0"}
                    {it.error ? (
                      <span className="upload-item__error">　失敗: {it.error}</span>
                    ) : null}
                    {it.status === "uploading" ? (
                      <M3eLinearProgressIndicator
                        className="upload-item__bar"
                        value={Math.round(it.progress * 100)}
                        max={100}
                        aria-label={`${it.fileName} の転送`}
                      />
                    ) : null}
                  </span>
                  <span slot="trailing" className="row">
                    <StatusText
                      tone={
                        it.status === "verified"
                          ? "success"
                          : it.status === "failed"
                            ? "error"
                            : "neutral"
                      }
                      {...(it.status === "verified" ? { icon: "check_circle" } : {})}
                      className={`upload-item__state upload-item__state--${it.status}`}
                    >
                      {
                        {
                          pending: "待機",
                          uploading:
                            it.phase === "compressing"
                              ? "圧縮しています"
                              : it.source === "figma"
                                ? "Figma から取り込み中"
                                : "転送中",
                          verified: "確認済み",
                          failed: "失敗",
                        }[it.status]
                      }
                    </StatusText>
                    {it.status === "failed" ? (
                      <M3eButton
                        variant="tonal"
                        onClick={() =>
                          void flow
                            .retry(it.itemId)
                            .catch((e: unknown) => setError(describeError(e).message))
                        }
                      >
                        {it.source === "figma" ? "再取り込み" : "再アップロード"}
                      </M3eButton>
                    ) : null}
                  </span>
                </M3eListItem>
              ))}
            </M3eList>
            {state.confirming ? <M3eLinearProgressIndicator aria-label="確定処理中" /> : null}
          </div>
        )}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          {flow ? "中止して戻る" : "キャンセル"}
        </M3eButton>
        {!flow ? (
          <M3eButton variant="filled" disabled={startDisabled} onClick={() => void start()}>
            {compressing ? "圧縮しています" : primaryLabel}
          </M3eButton>
        ) : (
          <M3eButton
            variant="filled"
            disabled={!canConfirm(state)}
            onClick={() => void flow.confirm().catch(() => undefined)}
          >
            提出する
          </M3eButton>
        )}
      </div>
    </M3eDialog>
  );
}
