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
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { Card } from "@/ui/Card";
import { DateField } from "@/ui/DateField";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import {
  M3eButton,
  M3eButtonSegment,
  M3eIcon,
  M3eIconButton,
  M3eList,
  M3eListItem,
  M3eSegmentedButton,
  M3eSwitch,
} from "@/ui/m3e";
import { PaneTabs } from "@/ui/PaneTabs";
import {
  FullscreenPreview,
  PostPreview,
  type PreviewImage,
  type PreviewView,
} from "./preview/PostPreview";
import { DevicePicker, usePreviewDevice } from "./preview/DevicePicker";

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
    update({
      account,
      ...(post.platform !== profile.platform
        ? { platform: profile.platform, format: socialFormats[profile.platform][0] as SocialFormat }
        : {}),
    });
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
  const replace = (next: SocialPost) => {
    setPost(next);
    dirty.current = true;
    setStatus((s) => ({ ...s, kind: "dirty" }));
  };
  const update = (patch: Partial<SocialPost>) => {
    setPost((p) => ({ ...p, ...patch }));
    dirty.current = true;
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
      <Card title="投稿先">
        <div className="stack">
          {profile ? (
            <div className="post-account">
              <span className="post-account__avatar" aria-hidden="true">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" />
                ) : (
                  Array.from(profile.displayName)[0]
                )}
              </span>
              <div className="post-account__name">
                <div className="label-large">{profile.displayName}</div>
                <div className="small muted">
                  {socialPlatformLabels[profile.platform]}・@{profile.username}
                </div>
              </div>
              <span className="small muted">制作物の「情報」で変更</span>
            </div>
          ) : (
            <>
              <div className="alert alert--info small">
                SNS
                アカウントが割り当てられていません。制作物の「情報」で選ぶと、サービスとアカウントの見た目がそろいます。
              </div>
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
            </>
          )}
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
          {profile ? null : (
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
          )}
          <DateField
            label="予定日（任意。予約投稿はしません）"
            value={post.scheduledAt ?? null}
            onChange={(v) => {
              if (v) update({ scheduledAt: v });
              else {
                const { scheduledAt: _s, ...rest } = post;
                replace(rest);
              }
            }}
          />
        </div>
      </Card>
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
              label="本文の表記の指摘"
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
          {!findings.length && rules && !rules.categories.length ? (
            <p className="small muted">
              表記統一のカテゴリが未設定のため、表記の検査はしていません（制作物の編集で選べます）。
            </p>
          ) : null}
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
        {post.images.length === 0 ? (
          <p className="small muted">
            画像を追加すると、並び順・代替テキスト・切り抜きを設定できます。
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
                    <Field label="代替テキスト（ALT）">
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
                        aria-label="前へ"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <M3eIcon name="arrow_upward" />
                      </M3eIconButton>
                      <M3eIconButton
                        aria-label="後ろへ"
                        disabled={i === post.images.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <M3eIcon name="arrow_downward" />
                      </M3eIconButton>
                      <M3eIconButton
                        aria-label="この画像を外す"
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
      {issues.length ? (
        <Card title="確認事項">
          <M3eList aria-label="確認事項">
            {issues.map((x, i) => (
              <M3eListItem key={i}>
                <M3eIcon
                  slot="leading"
                  name={x.level === "error" ? "error" : "warning"}
                  className={x.level === "error" ? "finding__icon" : ""}
                />
                {x.message}
              </M3eListItem>
            ))}
          </M3eList>
        </Card>
      ) : null}
    </div>
  );

  const previewPane = (
    <div className="post-preview stack">
      <div className="row">
        <DevicePicker device={device.device} color={device.color} onChange={device.set} />
        {compact ? (
          // スマホ: 自分の端末の画面いっぱいに出す（そのアプリが入っているように見える）
          <M3eButton variant="tonal" onClick={() => setFull(true)}>
            <M3eIcon slot="icon" name="fullscreen" />
            全画面で見る
          </M3eButton>
        ) : null}
        {post.platform === "instagram" && post.format !== "story" ? (
          <M3eSegmentedButton aria-label="表示">
            {(
              [
                ["post", "投稿"],
                ["grid", "プロフィール"],
              ] as const
            ).map(([v, l]) => (
              <M3eButtonSegment key={v} checked={view === v} onClick={() => setView(v)}>
                {l}
              </M3eButtonSegment>
            ))}
          </M3eSegmentedButton>
        ) : null}
        {post.platform === "instagram" && post.format === "story" ? (
          <label className="row small">
            <M3eSwitch
              checked={safeArea}
              onChange={(e) => setSafeArea((e.target as unknown as { checked: boolean }).checked)}
            />
            安全領域を表示
          </label>
        ) : null}
      </div>
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
      <AppBarSlot slot="title">{work.work.title}</AppBarSlot>
      <AppBarSlot slot="subtitle">
        <span className="write__status" role="status">
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
