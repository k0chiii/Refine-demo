import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import { useAuthToken } from "@convex-dev/auth/react";
import {
  accountOfProfile,
  applyFindings,
  charLength,
  checkPost,
  defaultAspect,
  emptyPost,
  extractHashtags,
  parsePostManifest,
  POST_BODY_NAME,
  POST_MANIFEST_NAME,
  postManifest,
  ALT_TEXT_GUIDE_MAX,
  socialAspects,
  socialFormatLabels,
  socialFormats,
  socialLimits,
  socialPlatformLabels,
  socialPlatforms,
  xWeightedLength,
  type Finding,
  type SocialFormat,
  type SocialPlatform,
  type SocialPost,
} from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AiAssist } from "@/features/notation/AiAssist";
import { FindingList } from "@/features/notation/FindingList";
import { useProofreader } from "@/features/notation/useProofreader";
import { SubmitDialog } from "@/features/upload/SubmitDialog";
import { fetchArtifactBlob } from "@/integrations/api";
import { formatJstShort } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Card } from "@/ui/Card";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import {
  M3eButton,
  M3eButtonSegment,
  M3eIcon,
  M3eIconButton,
  M3eList,
  M3eListItem,
  M3eSegmentedButton,
} from "@/ui/m3e";
import { PaneTabs } from "@/ui/PaneTabs";
import {
  FullscreenPreview,
  PostPreview,
  type PreviewImage,
  type PreviewView,
} from "./preview/PostPreview";
import { usePreviewDevice } from "./preview/DevicePicker";
import { PreviewSettings } from "./preview/PreviewSettings";

/** 画像の実体（URL と大きさ）。前の版の画像は添付から、新しい画像は端末のファイルから */
interface ImageAsset extends PreviewImage {
  file?: File;
  blob?: Blob;
}

const SAVE_DELAY = 1500;

/**
 * SNS 投稿の編集（`/works/:id/post`）。左で内容を編集し、右で Instagram / X の見た目を確かめる。
 * - 本文・アカウント・形式・画像の並び順・ALT・切り抜きを下書きとして自動保存（文章の下書きと同じ保存先）
 * - 「版として提出」で 本文（post-body.txt）・画像・内容の記録（mf100-post.json）を 1 つの版にする
 * - 本文は入力しながら表記の検査をする（端末の中で行い、外部に送らない）
 * - 実際の投稿・予約投稿はしない
 */
export function PostEditor({ workId }: { workId: string }) {
  const workData = useQuery(api.works.get, { workId });
  const docData = useQuery(api.documents.get, { workId });
  const latest = workData?.revisions.find((r) => r.reviewState !== "void") ?? null;
  const latestRev = useQuery(
    api.revisions.get,
    latest ? { revisionId: latest.id as Id<"revisions"> } : "skip",
  );
  if (workData === undefined || docData === undefined || (latest && latestRev === undefined))
    return <p className="muted write-loading">読み込み中…</p>;
  return (
    <PostSurface workId={workId} work={workData} doc={docData} latestRev={latestRev ?? null} />
  );
}

type WorkData = NonNullable<ReturnType<typeof useQuery<typeof api.works.get>>>;
type DocData = NonNullable<ReturnType<typeof useQuery<typeof api.documents.get>>>;
type RevData = NonNullable<ReturnType<typeof useQuery<typeof api.revisions.get>>>;

function PostSurface({
  workId,
  work,
  doc,
  latestRev,
}: {
  workId: string;
  work: WorkData;
  doc: DocData;
  latestRev: RevData | null;
}) {
  const navigate = useNavigate();
  const token = useAuthToken();
  const save = useMutation(api.documents.save);
  const win = useWindowClass();
  const wide = win === "expanded" || win === "large";
  const compact = win === "compact";
  const [full, setFull] = useState(false);
  const canEdit = doc.canEdit;
  const canSubmit = work.can.submit && work.work.lifecycle === "active";

  // 開いたときの内容: 下書きが新しければ下書き、版の方が新しければ版の内容
  const [post, setPost] = useState<SocialPost>(() => {
    const fromDraft = doc.draft ? parsePostManifest(safeJson(doc.draft.content)) : null;
    if (fromDraft && (!latestRev || doc.draft!.updatedAt >= latestRev.revision.submittedAt))
      return fromDraft;
    return emptyPost();
  });
  const [assets, setAssets] = useState<Map<string, ImageAsset>>(new Map());
  const baseVersion = useRef(doc.draft?.version ?? 0);
  const dirty = useRef(false);
  /** この画面で一度でも編集したか（注意のスナックバーは編集してから出す） */
  const edited = useRef(false);
  const [status, setStatus] = useState<{
    kind: "saved" | "dirty" | "saving" | "error" | "conflict";
    at: number | null;
  }>({
    kind: "saved",
    at: doc.draft?.updatedAt ?? null,
  });
  // 投稿するアカウント: 制作物に割り当てた SNS アカウント（本体の設定）。割り当てがあればサービスと見た目はそれに従う
  const profiles = useQuery(api.social.list, {});
  const profile = profiles?.find((p) => p.id === work.work.socialProfileId) ?? null;
  useEffect(() => {
    if (!profile || !canEdit) return;
    const account = accountOfProfile(profile);
    if (
      post.platform === profile.platform &&
      JSON.stringify(post.account) === JSON.stringify(account)
    )
      return;
    // 自動で写すのは利用者の編集ではない（注意のスナックバーを出す条件に数えない）
    const wasEdited = edited.current;
    update({
      account,
      ...(post.platform !== profile.platform
        ? { platform: profile.platform, format: socialFormats[profile.platform][0] as SocialFormat }
        : {}),
    });
    edited.current = wasEdited;
    // 割り当てたアカウントが変わったときだけ写す
  }, [profile?.id, profile?.updatedAt, canEdit]);
  const device = usePreviewDevice();
  const [view, setView] = useState<PreviewView>("post");
  const [safeArea, setSafeArea] = useState(true);
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const [submitFiles, setSubmitFiles] = useState<File[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 版の内容から始める（下書きが無い・古い）
  useEffect(() => {
    if (!latestRev || !token) return;
    const usingDraft = doc.draft && doc.draft.updatedAt >= latestRev.revision.submittedAt;
    const manifestArt = latestRev.artifacts.find((a) => a.fileName === POST_MANIFEST_NAME);
    if (usingDraft || !manifestArt) return;
    void fetchArtifactBlob(token, manifestArt.id)
      .then((b) => b.text())
      .then((t) => {
        const p = parsePostManifest(safeJson(t));
        if (!p) return;
        const byName = new Map(latestRev.artifacts.map((a) => [a.fileName, a.id]));
        setPost({
          ...p,
          images: p.images.map((im) => {
            const id = byName.get(im.fileName);
            return id ? { ...im, artifactId: id } : im;
          }),
        });
      })
      .catch(() => undefined);
  }, [latestRev?.revision.id, token]);

  // 前の版の画像を読み込む
  useEffect(() => {
    if (!token) return;
    for (const im of post.images) {
      if (assets.has(im.key) || !im.artifactId) continue;
      const key = im.key;
      void fetchArtifactBlob(token, im.artifactId)
        .then(async (blob) => {
          const url = URL.createObjectURL(blob);
          const { w, h } = await sizeOf(url);
          setAssets((m) => new Map(m).set(key, { key, url, w, h, blob }));
        })
        .catch(() => undefined);
    }
  }, [post.images, token]);

  // 自動保存
  const update = (patch: Partial<SocialPost>) => {
    setPost((p) => ({ ...p, ...patch }));
    dirty.current = true;
    edited.current = true;
    setStatus((s) => ({ ...s, kind: "dirty" }));
  };
  useEffect(() => {
    if (!dirty.current || !canEdit) return;
    const t = window.setTimeout(() => {
      dirty.current = false;
      setStatus((s) => ({ ...s, kind: "saving" }));
      save({
        workId: workId as Id<"works">,
        title: work.work.title,
        content: postManifest(post),
        text: post.body,
        baseVersion: baseVersion.current,
      })
        .then((r) => {
          baseVersion.current = r.version;
          setStatus({ kind: "saved", at: r.updatedAt });
        })
        .catch((e: unknown) =>
          setStatus((s) => ({
            ...s,
            kind: String(e).includes("version_conflict") ? "conflict" : "error",
          })),
        );
    }, SAVE_DELAY);
    return () => window.clearTimeout(t);
  }, [post]);

  // 本文の表記の検査（入力が止まってから）
  const rules = useQuery(api.notation.rulesForWork, { workId });
  const check = useProofreader(rules?.rules ?? null);
  const [findings, setFindings] = useState<Finding[]>([]);
  useEffect(() => {
    if (!rules?.rules.length) return;
    const t = window.setTimeout(
      () => void check(post.body).then((r) => setFindings(r.findings)),
      800,
    );
    return () => window.clearTimeout(t);
  }, [post.body, rules]);

  const issues = useMemo(() => checkPost(post), [post]);
  // 注意・警告はカードに並べず、スナックバーで知らせる（利用者指示 2026-10-15）。
  // 編集の手が止まって 1.5 秒たったら、新しく出た問題だけを 1 回知らせる（打つたびに出さない）。
  // 開いたときから残っている問題（空の下書きの「画像が必要」など）は知らせず、提出のときに止める
  const told = useRef(new Set<string>());
  /** 提出を押したか（押した後は、直すべき欄を M3 のエラー表示にする。§35 A-17） */
  const [triedSubmit, setTriedSubmit] = useState(false);
  useEffect(() => {
    if (!canEdit) return;
    const t = window.setTimeout(() => {
      const fresh = issues.filter((x) => !told.current.has(x.message));
      for (const x of issues) told.current.add(x.message);
      // 解消した問題は、また出たときに知らせる
      for (const m of told.current)
        if (!issues.some((x) => x.message === m)) told.current.delete(m);
      const first = fresh[0];
      if (first && edited.current)
        toast(
          fresh.length > 1 ? `${first.message}（ほか ${fresh.length - 1} 件）` : first.message,
          {
            kind: first.level === "error" ? "error" : "warning",
          },
        );
    }, 1500);
    return () => window.clearTimeout(t);
  }, [issues, canEdit]);
  // 開いたときの案内（1 回だけ）: アカウント未割り当て、または表記統一のカテゴリ未設定
  const hinted = useRef(false);
  useEffect(() => {
    if (hinted.current || !canEdit || rules === undefined || profiles === undefined) return;
    hinted.current = true;
    if (!profile)
      toast("SNS アカウントが割り当てられていません。制作物の「情報」で選ぶと見た目がそろいます。");
    else if (rules && !rules.categories.length)
      toast("表記の検査をしていません。制作物の「編集」で表記統一のカテゴリを選んでください。");
  }, [rules, profiles, profile, canEdit]);
  const previewImages = post.images
    .map((im) => assets.get(im.key))
    .filter((x): x is ImageAsset => !!x);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: SocialPost["images"] = [];
    const next = new Map(assets);
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      const key = `img-${crypto.randomUUID().slice(0, 8)}`;
      const url = URL.createObjectURL(f);
      const { w, h } = await sizeOf(url);
      next.set(key, { key, url, w, h, file: f });
      added.push({ key, fileName: f.name, alt: "", aspect: defaultAspect[post.format] });
    }
    setAssets(next);
    update({ images: [...post.images, ...added] });
  };
  const move = (i: number, d: -1 | 1) => {
    const list = [...post.images];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    update({ images: list });
  };
  const setImage = (i: number, patch: Partial<SocialPost["images"][number]>) =>
    update({ images: post.images.map((im, k) => (k === i ? { ...im, ...patch } : im)) });

  const startSubmit = async () => {
    setTriedSubmit(true);
    // 直さないと出せない問題（error）があれば、提出の前にスナックバーで知らせて止める
    const errors = issues.filter((x) => x.level === "error");
    const firstError = errors[0];
    if (firstError) {
      toast(
        errors.length > 1
          ? `${firstError.message}（ほか ${errors.length - 1} 件）`
          : firstError.message,
        { kind: "error" },
      );
      return;
    }
    // 並び順が分かるファイル名にする（01-xxx.jpg）。内容の記録もその名前で書く
    const files: File[] = [];
    const images = [];
    for (const [i, im] of post.images.entries()) {
      const a = assets.get(im.key);
      const src = a?.file ?? a?.blob;
      if (!src) continue;
      const base = im.fileName.replace(/^\d{2}-/, "");
      const name = `${String(i + 1).padStart(2, "0")}-${base}`;
      files.push(new File([src], name, { type: src.type || "image/png" }));
      const { artifactId: _a, ...rest } = im;
      images.push({ ...rest, fileName: name });
    }
    const snapshot: SocialPost = { ...post, images };
    files.unshift(new File([post.body], POST_BODY_NAME, { type: "text/plain" }));
    files.push(
      new File([postManifest(snapshot)], POST_MANIFEST_NAME, { type: "application/json" }),
    );
    setSubmitFiles(files);
  };

  const count =
    post.platform === "x"
      ? `${xWeightedLength(post.body)} / ${socialLimits.x.weightedMax}（日本語 2・URL 23 の近似）`
      : `${charLength(post.body)} / ${socialLimits.instagram.bodyMax} 文字・ハッシュタグ ${extractHashtags(post.body).length} / ${socialLimits.instagram.hashtagsMax}`;
  const statusText =
    status.kind === "saving"
      ? "保存しています…"
      : status.kind === "dirty"
        ? "未保存の変更"
        : status.kind === "error"
          ? "保存できませんでした"
          : status.kind === "conflict"
            ? "他の人の変更があります。読み込み直してください"
            : status.at
              ? `下書きを保存しました・${formatJstShort(status.at)}`
              : "まだ保存していません";

  const editPane = (
    <div className="post-edit gform">
      {/* 投稿先: SNS アカウントを割り当てていない（古い）制作物だけ。割り当て済みならアカウントはプレビューに出る */}
      {profile ? null : (
        <Card title="投稿先">
          <div className="stack">
            <M3eSegmentedButton aria-label="サービス">
              {socialPlatforms.map((p) => (
                <M3eButtonSegment
                  key={p}
                  checked={post.platform === p}
                  disabled={!canEdit}
                  onClick={() => {
                    if (post.platform === p) return;
                    const format = socialFormats[p][0] as SocialFormat;
                    update({ platform: p as SocialPlatform, format });
                  }}
                >
                  {socialPlatformLabels[p]}
                </M3eButtonSegment>
              ))}
            </M3eSegmentedButton>
            <div className="rule-editor__grid">
              <Field label="表示名">
                <TextInput
                  value={post.account.displayName}
                  disabled={!canEdit}
                  onChange={(e) =>
                    update({ account: { ...post.account, displayName: e.target.value } })
                  }
                />
              </Field>
              <Field label="ユーザー名（@ なし）">
                <TextInput
                  value={post.account.username}
                  disabled={!canEdit}
                  onChange={(e) =>
                    update({
                      account: { ...post.account, username: e.target.value.replace(/^@/, "") },
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Card>
      )}
      <Card title="本文">
        <div className="stack">
          <Field label="投稿する文章（ハッシュタグ・URL を含む）" hint={count}>
            <TextArea
              rows={8}
              value={post.body}
              disabled={!canEdit}
              onChange={(e) => update({ body: e.target.value })}
            />
          </Field>
          {findings.length ? (
            <FindingList
              label="本文の表記の確認箇所"
              findings={findings}
              actions={(f) =>
                canEdit && f.suggestion ? (
                  <M3eIconButton
                    aria-label={`「${f.suggestion}」に修正`}
                    title="修正"
                    onClick={() => update({ body: applyFindings(post.body, [f]) })}
                  >
                    <M3eIcon name="check" />
                  </M3eIconButton>
                ) : null
              }
            />
          ) : null}
          <AiAssist
            workId={workId}
            readOnly={!canEdit}
            getText={() => post.body}
            onApply={(f) => {
              const at =
                post.body.slice(f.start, f.end) === f.original
                  ? f.start
                  : post.body.indexOf(f.original);
              if (at < 0) return;
              update({
                body:
                  post.body.slice(0, at) + f.suggestion + post.body.slice(at + f.original.length),
              });
            }}
          />
        </div>
      </Card>
      <Card
        title={`画像（${post.images.length}）`}
        actions={
          canEdit ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
              <M3eButton variant="tonal" onClick={() => fileRef.current?.click()}>
                <M3eIcon slot="icon" name="add_photo_alternate" />
                画像を追加
              </M3eButton>
            </>
          ) : null
        }
      >
        {post.platform === "instagram" ? (
          <M3eSegmentedButton aria-label="形式">
            {socialFormats.instagram.map((f) => (
              <M3eButtonSegment
                key={f}
                checked={post.format === f}
                disabled={!canEdit}
                onClick={() => update({ format: f })}
              >
                {/* 狭い画面では「（1 枚）」などの補足を外す（3 つ並べると画面からはみ出していた） */}
                {compact ? socialFormatLabels[f].replace(/（.*）$/, "") : socialFormatLabels[f]}
              </M3eButtonSegment>
            ))}
          </M3eSegmentedButton>
        ) : null}
        {post.images.length === 0 ? (
          <p className="small muted">
            画像を追加すると、並び順・代替テキスト・切り抜きを設定できます
          </p>
        ) : (
          <M3eList aria-label="画像" className="post-images">
            {post.images.map((im, i) => {
              const a = assets.get(im.key);
              return (
                <M3eListItem key={im.key} className="post-image">
                  {a ? (
                    <img slot="leading" className="post-image__thumb" src={a.url} alt="" />
                  ) : (
                    <M3eIcon slot="leading" name="image" />
                  )}
                  <span slot="overline">
                    {i + 1} 枚目
                    {!a
                      ? im.artifactId
                        ? "・読み込み中"
                        : "・この端末に無い画像です。選び直してください"
                      : ""}
                  </span>
                  {im.fileName.replace(/^\d{2}-/, "")}
                  <span slot="supporting-text" className="post-image__fields">
                    <Field
                      label="代替テキスト"
                      // 編集した後・提出を押した後に空なら、欄を M3 のエラー表示に（スナックバーは消えるので欄にも残す。§35 A-17）
                      {...((edited.current || triedSubmit) && !im.alt.trim()
                        ? { error: "代替テキストを入力してください" }
                        : {})}
                      hint={`画像の内容を短く書きます。画像の中の文字（日時・場所など）も書き、「〜の画像」で始めません（${Array.from(im.alt).length} / ${ALT_TEXT_GUIDE_MAX}）`}
                    >
                      <TextInput
                        value={im.alt}
                        disabled={!canEdit}
                        onChange={(e) => setImage(i, { alt: e.target.value })}
                      />
                    </Field>
                    <Field label="切り抜き">
                      <Select
                        value={im.aspect}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setImage(i, { aspect: e.target.value as typeof im.aspect })
                        }
                      >
                        {socialAspects.map((s) => (
                          <option key={s} value={s}>
                            {s === "original" ? "元の比率" : s}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </span>
                  {canEdit ? (
                    <span slot="trailing" className="post-image__actions">
                      <M3eIconButton
                        aria-label={`${i + 1} 枚目を前へ移動`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <M3eIcon name="arrow_upward" />
                      </M3eIconButton>
                      <M3eIconButton
                        aria-label={`${i + 1} 枚目を後ろへ移動`}
                        disabled={i === post.images.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <M3eIcon name="arrow_downward" />
                      </M3eIconButton>
                      <M3eIconButton
                        aria-label={`${i + 1} 枚目を外す`}
                        onClick={() => update({ images: post.images.filter((_, k) => k !== i) })}
                      >
                        <M3eIcon name="delete" />
                      </M3eIconButton>
                    </span>
                  ) : null}
                </M3eListItem>
              );
            })}
          </M3eList>
        )}
      </Card>
    </div>
  );

  const previewPane = (
    <div className="post-preview stack">
      <PostPreview
        post={post}
        {...(profile ? { profile } : {})}
        images={previewImages}
        device={device.device}
        {...(device.color ? { color: device.color } : {})}
        view={view}
        safeArea={safeArea}
      />
      {full ? (
        <FullscreenPreview
          post={post}
          {...(profile ? { profile } : {})}
          images={previewImages}
          view={view}
          safeArea={safeArea}
          onClose={() => setFull(false)}
        />
      ) : null}
      {/* 機種・表示の設定は FAB menu にしまう（上に選択欄を並べない） */}
      <PreviewSettings
        device={device.device}
        color={device.color}
        onDevice={device.set}
        {...(post.platform === "instagram" && post.format !== "story"
          ? { view, onView: setView }
          : {})}
        {...(post.platform === "instagram" && post.format === "story"
          ? { safeArea, onSafeArea: setSafeArea }
          : {})}
        {...(compact ? { onFullscreen: () => setFull(true) } : {})}
        compact={compact}
      />
    </div>
  );

  return (
    <div className="post">
      <AppBarSlot slot="leading">
        <M3eIconButton
          aria-label="制作物へ戻る"
          onClick={() => void navigate({ to: "/works/$workId", params: { workId } })}
        >
          <M3eIcon name="arrow_back" className="icon--mirror" />
        </M3eIconButton>
      </AppBarSlot>
      <AppBarSlot slot="title" title={work.work.title}>
        {work.work.title}
      </AppBarSlot>
      <AppBarSlot slot="subtitle">
        {/* 保存の状態は打つたびに変わるので読み上げない。失敗・競合だけ知らせる（§35 A-13） */}
        <span
          className="write__status"
          {...(status.kind === "error" || status.kind === "conflict" ? { role: "alert" } : {})}
        >
          {canEdit ? statusText : "閲覧のみ（書けるのは版を提出できる人です）"}
        </span>
      </AppBarSlot>
      <AppBarSlot slot="actions">
        {canEdit && canSubmit ? (
          compact ? (
            // 狭い画面は文章エディタと同じアイコンのボタン（文字のボタンだと題名が「公…」まで潰れていた）
            <M3eIconButton
              variant="tonal"
              aria-label="版として提出"
              onClick={() => void startSubmit()}
            >
              <M3eIcon name="upload_file" />
            </M3eIconButton>
          ) : (
            <M3eButton variant="filled" onClick={() => void startSubmit()}>
              <M3eIcon slot="icon" name="upload_file" />
              版として提出
            </M3eButton>
          )
        ) : null}
      </AppBarSlot>
      {wide ? (
        <div className="post__split">
          {editPane}
          {previewPane}
        </div>
      ) : (
        <>
          <PaneTabs
            label="編集とプレビュー"
            value={pane}
            onChange={setPane}
            items={[
              { id: "edit", label: "編集" },
              { id: "preview", label: "プレビュー" },
            ]}
          />
          {pane === "edit" ? editPane : previewPane}
        </>
      )}
      <SubmitDialog
        workId={workId}
        open={submitFiles !== null}
        onClose={() => setSubmitFiles(null)}
        {...(submitFiles ? { initialFiles: submitFiles } : {})}
      />
    </div>
  );
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function sizeOf(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = url;
  });
}
