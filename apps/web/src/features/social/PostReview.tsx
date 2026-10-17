import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { parsePostManifest, POST_BODY_NAME, type SocialPost } from "@mf100/domain";
import { useEffect, useState } from "react";
import { fetchArtifactBlob } from "@/integrations/api";
import { useAction } from "@/lib/useAction";
import { Card } from "@/ui/Card";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList, M3eListItem } from "@m3e/react/list";
import {
  FullscreenPreview,
  PostPreview,
  type PreviewImage,
  type PreviewView,
} from "./preview/PostPreview";
import { useWindowClass } from "@/lib/useMedia";
import { usePreviewDevice } from "./preview/DevicePicker";
import { PreviewSettings } from "./preview/PreviewSettings";
import { makeZip } from "./zip";
import { toast } from "@/lib/toast";
import { describeError } from "@/lib/errors";

interface ArtifactLike {
  id: string;
  fileName: string;
  type: string;
}

/**
 * 校正画面での SNS 投稿の表示（版に記録した内容から組み立てるプレビュー）と、校了版の書き出し。
 * - 書き出しは校了した版だけ（校了前の版を投稿用と取り違えないため）
 * - 実際の投稿はしない。本文のコピー・画像の保存・まとめて ZIP
 */
export function PostReview({
  manifestArtifactId,
  artifacts,
  isFinal,
  workTitle,
  socialProfileId,
  revisionLabel,
}: {
  manifestArtifactId: string;
  artifacts: readonly ArtifactLike[];
  isFinal: boolean;
  workTitle: string;
  /** 制作物に割り当てた SNS アカウント（プロフィール画面の自己紹介・数字に使う） */
  socialProfileId?: string | undefined;
  revisionLabel: string;
}) {
  const profiles = useQuery(api.social.list, socialProfileId ? {} : "skip");
  const profile = profiles?.find((p) => p.id === socialProfileId);
  const token = useAuthToken();
  const [post, setPost] = useState<SocialPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Array<PreviewImage & { blob: Blob; fileName: string }>>([]);
  const device = usePreviewDevice();
  // スマホでは自分の端末の画面いっぱいに出す全画面のプレビューも選べる
  const compact = useWindowClass() === "compact";
  const [full, setFull] = useState(false);
  const [view, setView] = useState<PreviewView>("post");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      try {
        const m = parsePostManifest(
          JSON.parse(await (await fetchArtifactBlob(token, manifestArtifactId)).text()),
        );
        if (!m) throw new Error("投稿の記録を読めません");
        if (cancelled) return;
        setPost(m);
        const byName = new Map(artifacts.map((a) => [a.fileName, a]));
        const out = [];
        for (const im of m.images) {
          const a = byName.get(im.fileName);
          if (!a) continue;
          const blob = await fetchArtifactBlob(token, a.id);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          const size = await new Promise<{ w: number; h: number }>((r) => {
            const img = new Image();
            img.onload = () => r({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => r({ w: 1, h: 1 });
            img.src = url;
          });
          out.push({ key: im.key, url, ...size, blob, fileName: im.fileName });
        }
        if (!cancelled) setImages(out);
      } catch (e) {
        if (!cancelled) setError(describeError(e).message);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [manifestArtifactId, token]);

  const save = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const altText = (p: SocialPost) =>
    p.images.map((im, i) => `${i + 1}. ${im.fileName}\n${im.alt || "（未設定）"}`).join("\n\n") +
    "\n";
  const zip = useAction(async () => {
    if (!post) return;
    const enc = new TextEncoder();
    const entries = [
      { name: POST_BODY_NAME, data: enc.encode(post.body) },
      { name: "alt.txt", data: enc.encode(altText(post)) },
      {
        name: "manifest.json",
        data: enc.encode(
          JSON.stringify(
            { kind: "mf100-post-export", work: workTitle, revision: revisionLabel, ...post },
            null,
            2,
          ),
        ),
      },
      ...(await Promise.all(
        images.map(async (im) => ({
          name: `images/${im.fileName}`,
          data: new Uint8Array(await im.blob.arrayBuffer()),
        })),
      )),
    ];
    save(
      `${workTitle}-${revisionLabel}.zip`,
      new Blob([makeZip(entries) as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    );
  });

  if (error) return <div className="alert">{error}</div>;
  if (!post) return <Loading label="投稿を読み込んでいます" />;
  return (
    <div className="post-review">
      <div className="post-preview stack">
        {/* 機種・表示の設定: 校正画面は浮遊ツールバーがあるので FAB menu ではなく、右上のボタンから menu */}
        <div className="post-preview__bar">
          <PreviewSettings
            device={device.device}
            color={device.color}
            onDevice={device.set}
            {...(post.platform === "instagram" && post.format !== "story"
              ? { view, onView: setView }
              : {})}
            {...(compact ? { onFullscreen: () => setFull(true) } : {})}
            compact={compact}
            placement="inline"
          />
        </div>
        <PostPreview
          post={post}
          images={images}
          device={device.device}
          {...(device.color ? { color: device.color } : {})}
          view={view}
          safeArea
          {...(profile ? { profile } : {})}
        />
        {full ? (
          <FullscreenPreview
            post={post}
            images={images}
            view={view}
            safeArea
            {...(profile ? { profile } : {})}
            onClose={() => setFull(false)}
          />
        ) : null}
        <p className="small muted">
          本文へのコメントは添付「{POST_BODY_NAME}」に、画像へのコメントは各画像の添付に付けます
        </p>
      </div>
      <Card title="投稿用に書き出す">
        {isFinal ? (
          <div className="stack">
            <p className="small muted">校了した版の内容です。この画面から投稿はしません。</p>
            <div className="row">
              <M3eButton
                variant="tonal"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(post.body)
                    .then(() => toast("本文をコピーしました"))
                }
              >
                <M3eIcon slot="icon" name="content_copy" />
                本文をコピー
              </M3eButton>
              <M3eButton variant="filled" disabled={zip.pending} onClick={() => void zip.run()}>
                <M3eIcon slot="icon" name="folder_zip" />
                ZIP で保存
              </M3eButton>
            </div>
            <p className="small muted">ZIP には本文・画像・代替テキスト・記録をまとめます</p>
            <M3eList aria-label="画像（投稿の順）">
              {post.images.map((im, i) => {
                const a = images.find((x) => x.key === im.key);
                return (
                  <M3eListItem key={im.key}>
                    {a ? (
                      <img slot="leading" className="post-image__thumb" src={a.url} alt="" />
                    ) : null}
                    <span slot="overline">{i + 1} 枚目</span>
                    {im.fileName}
                    <span slot="supporting-text">代替テキスト: {im.alt || "未設定"}</span>
                    {a ? (
                      <M3eButton
                        slot="trailing"
                        variant="text"
                        onClick={() => save(im.fileName, a.blob)}
                      >
                        画像を保存
                      </M3eButton>
                    ) : null}
                  </M3eListItem>
                );
              })}
            </M3eList>
          </div>
        ) : (
          <p className="small muted">
            書き出しは校了した版だけでできます（校了前の版を投稿用と取り違えないため）
          </p>
        )}
      </Card>
    </div>
  );
}
