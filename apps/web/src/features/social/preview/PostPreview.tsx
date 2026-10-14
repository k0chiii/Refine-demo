import {
  cropRect,
  extractHashtags,
  extractMentions,
  extractUrls,
  type SocialAspect,
  type SocialPost,
} from "@mf100/domain";
import { useState, type ReactNode } from "react";
import "./preview.css";

/**
 * SNS 投稿のプレビュー（テンプレート集。編集画面・校正画面・書き出しで共用する独立したモジュール）。
 * 実際の Instagram / X の画面ではなく、公開されている見た目に寄せた近似。文字の折り返し・切り詰め・
 * 余白はサービスや端末の設定で変わるため、確定の表示は実機で確認する（画面に注記を出す）。
 */
export interface PreviewImage {
  key: string;
  url: string;
  /** 元画像の大きさ（切り抜きの計算用） */
  w: number;
  h: number;
}
export type PreviewDevice = "iphone" | "android" | "pc";
export type PreviewView = "post" | "grid" | "story";

const ratio = (a: SocialAspect, w: number, h: number) => {
  if (a === "original") return w > 0 && h > 0 ? w / h : 1;
  const [x, y] = a.split(":").map(Number) as [number, number];
  return x / y;
};

/** 比率と焦点で切り抜いて表示する（元画像は変えない） */
export function CroppedImage({
  image,
  aspect,
  focus,
  alt,
  className,
}: {
  image: PreviewImage | undefined;
  aspect: SocialAspect;
  focus?: { x: number; y: number } | undefined;
  alt: string;
  className?: string;
}) {
  const r = image ? cropRect(aspect, image.w, image.h, focus) : { x: 0, y: 0, w: 1, h: 1 };
  return (
    <div
      className={`sp-img ${className ?? ""}`}
      style={{ aspectRatio: String(image ? ratio(aspect, image.w, image.h) : 1) }}
    >
      {image ? (
        <img
          src={image.url}
          alt={alt}
          draggable={false}
          style={{
            width: `${100 / r.w}%`,
            height: `${100 / r.h}%`,
            left: `${(-r.x / r.w) * 100}%`,
            top: `${(-r.y / r.h) * 100}%`,
          }}
        />
      ) : (
        <span className="sp-img__none">画像なし</span>
      )}
    </div>
  );
}

/** 本文（ハッシュタグ・URL・メンションを色付け。Instagram は長文を「続きを読む」で切る） */
export function PostText({ text, clamp }: { text: string; clamp?: number }) {
  const [open, setOpen] = useState(false);
  const cut = clamp && !open && Array.from(text).length > clamp;
  const shown = cut ? Array.from(text).slice(0, clamp).join("") : text;
  const marks = [
    ...extractHashtags(shown).map((m) => ({ ...m, cls: "sp-tag" })),
    ...extractUrls(shown).map((m) => ({ ...m, cls: "sp-link" })),
    ...extractMentions(shown).map((m) => ({ ...m, cls: "sp-tag" })),
  ].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [i, m] of marks.entries()) {
    if (m.start < at) continue;
    if (m.start > at) parts.push(shown.slice(at, m.start));
    parts.push(
      <span key={i} className={m.cls}>
        {shown.slice(m.start, m.end)}
      </span>,
    );
    at = m.end;
  }
  parts.push(shown.slice(at));
  return (
    <span className="sp-text">
      {parts}
      {cut ? (
        <button type="button" className="sp-more" onClick={() => setOpen(true)}>
          …続きを読む
        </button>
      ) : null}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="sp-avatar" aria-hidden="true">
      {Array.from(name || "?")[0]}
    </span>
  );
}

function InstagramPost({ post, images }: { post: SocialPost; images: PreviewImage[] }) {
  const [index, setIndex] = useState(0);
  const list = post.images;
  const cur = list[Math.min(index, Math.max(0, list.length - 1))];
  const user = post.account.username || "username";
  return (
    <article className="sp-ig">
      <header className="sp-ig__head">
        <Avatar name={post.account.displayName || user} />
        <b>{user}</b>
        <span className="sp-ig__dots">•••</span>
      </header>
      <div className="sp-ig__media">
        <CroppedImage
          image={images.find((i) => i.key === cur?.key)}
          aspect={cur?.aspect ?? "1:1"}
          focus={cur?.focus}
          alt={cur?.alt ?? ""}
        />
        {list.length > 1 ? (
          <>
            <span className="sp-ig__count">
              {index + 1}/{list.length}
            </span>
            {index > 0 ? (
              <button
                type="button"
                className="sp-nav sp-nav--prev"
                aria-label="前の画像"
                onClick={() => setIndex(index - 1)}
              >
                ‹
              </button>
            ) : null}
            {index < list.length - 1 ? (
              <button
                type="button"
                className="sp-nav sp-nav--next"
                aria-label="次の画像"
                onClick={() => setIndex(index + 1)}
              >
                ›
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="sp-ig__actions" aria-hidden="true">
        <span>♡</span>
        <span>💬</span>
        <span>➤</span>
        {list.length > 1 ? (
          <span className="sp-ig__pager">
            {list.map((im, i) => (
              <i key={im.key} className={i === index ? "on" : ""} />
            ))}
          </span>
        ) : null}
        <span className="sp-ig__save">🔖</span>
      </div>
      <p className="sp-ig__caption">
        <b>{user}</b> <PostText text={post.body} clamp={125} />
      </p>
    </article>
  );
}

function InstagramStory({
  post,
  images,
  safeArea,
}: {
  post: SocialPost;
  images: PreviewImage[];
  safeArea: boolean;
}) {
  const cur = post.images[0];
  const user = post.account.username || "username";
  return (
    <div className="sp-story">
      <CroppedImage
        image={images.find((i) => i.key === cur?.key)}
        aspect="9:16"
        focus={cur?.focus}
        alt={cur?.alt ?? ""}
      />
      <div className="sp-story__top">
        <i className="sp-story__bar" />
        <span className="sp-story__user">
          <Avatar name={post.account.displayName || user} /> {user}
        </span>
      </div>
      <div className="sp-story__reply">メッセージを送信</div>
      {safeArea ? (
        <div className="sp-story__safe" aria-label="安全領域（上下 14% は UI と重なる目安）">
          <span>上 14%: アカウント名・進行バー</span>
          <span>下 20%: 返信欄</span>
        </div>
      ) : null}
    </div>
  );
}

function InstagramGrid({ post, images }: { post: SocialPost; images: PreviewImage[] }) {
  const user = post.account.username || "username";
  const tiles = [...post.images.slice(0, 1), ...Array.from({ length: 8 }, () => null)];
  return (
    <div className="sp-grid-page">
      <header className="sp-grid__head">
        <Avatar name={post.account.displayName || user} />
        <div>
          <b>{user}</b>
          <div className="sp-muted">{post.account.displayName}</div>
        </div>
      </header>
      <div className="sp-grid">
        {tiles.map((t, i) =>
          t ? (
            <CroppedImage
              key={i}
              image={images.find((x) => x.key === t.key)}
              aspect="4:5"
              focus={t.focus}
              alt={t.alt}
              className="sp-grid__tile"
            />
          ) : (
            <div key={i} className="sp-grid__tile sp-grid__tile--empty" aria-hidden="true" />
          ),
        )}
      </div>
      <p className="sp-muted sp-note">
        先頭が今回の投稿（1 枚目）。他は既存の投稿の位置の目安です。
      </p>
    </div>
  );
}

function XPost({ post, images }: { post: SocialPost; images: PreviewImage[] }) {
  const user = post.account.username || "username";
  const list = post.images.slice(0, 4);
  return (
    <article className="sp-x">
      <Avatar name={post.account.displayName || user} />
      <div className="sp-x__main">
        <div className="sp-x__head">
          <b>{post.account.displayName || "表示名"}</b>{" "}
          <span className="sp-muted">@{user}・今</span>
        </div>
        <p className="sp-x__text">
          <PostText text={post.body} />
        </p>
        {list.length ? (
          <div className={`sp-x__media sp-x__media--${list.length}`}>
            {list.map((im) => (
              <CroppedImage
                key={im.key}
                image={images.find((x) => x.key === im.key)}
                aspect={list.length === 1 ? im.aspect : list.length === 2 ? "4:5" : "16:9"}
                focus={im.focus}
                alt={im.alt}
              />
            ))}
          </div>
        ) : null}
        <div className="sp-x__actions sp-muted" aria-hidden="true">
          <span>💬</span>
          <span>🔁</span>
          <span>♡</span>
          <span>📊</span>
        </div>
      </div>
    </article>
  );
}

/** 端末の枠（iPhone / Android / PC）。幅は各端末の CSS ピクセルの代表値 */
function DeviceFrame({
  device,
  dark,
  children,
}: {
  device: PreviewDevice;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`sp-device sp-device--${device} ${dark ? "sp-device--dark" : ""}`}>
      {device !== "pc" ? (
        <div className="sp-device__status" aria-hidden="true">
          9:41
        </div>
      ) : null}
      <div className="sp-device__screen">{children}</div>
    </div>
  );
}

export function PostPreview({
  post,
  images,
  device,
  view,
  safeArea = false,
}: {
  post: SocialPost;
  images: PreviewImage[];
  device: PreviewDevice;
  view: PreviewView;
  safeArea?: boolean;
}) {
  const story = post.platform === "instagram" && (post.format === "story" || view === "story");
  return (
    <figure className="sp-figure" aria-label="投稿のプレビュー">
      <DeviceFrame device={device} dark={story}>
        {post.platform === "x" ? (
          <XPost post={post} images={images} />
        ) : story ? (
          <InstagramStory post={post} images={images} safeArea={safeArea} />
        ) : view === "grid" ? (
          <InstagramGrid post={post} images={images} />
        ) : (
          <InstagramPost post={post} images={images} />
        )}
      </DeviceFrame>
      <figcaption className="sp-caption">
        見た目の近似です。実際の表示（折り返し・切り詰め・余白）はサービスと端末で変わります。
      </figcaption>
    </figure>
  );
}
