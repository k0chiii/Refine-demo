import {
  cropRect,
  extractHashtags,
  extractMentions,
  extractUrls,
  type SocialAspect,
  type SocialPost,
} from "@mf100/domain";
import { useState, type ReactNode } from "react";
import { Icon, StatusIcons } from "./icons";
import "./preview.css";

/**
 * SNS 投稿のプレビュー（編集画面・校正画面・書き出しで共用）。
 * 実物の画面（2026 年時点のスマホアプリ）の並び・文字の大きさ・色に寄せた再現。寸法と色は各サービスの公開ページ
 * （埋め込み表示）を実測した値を使う（docs/UI_M3E.md §28）。ロゴとアイコンは各サービスの Web 版の SVG を写したもの
 * （団体内でだけ使う前提。icons.tsx）。
 * 文字の折り返し・切り詰めは端末やアプリの版で変わるので、確定の表示は実機で確認する（画面に注記を出す）。
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
/** プロフィール画面に出す見た目（本体の設定の SNS アカウント） */
export interface PreviewProfile {
  displayName: string;
  username: string;
  avatar?: string;
  bio?: string;
  verified: boolean;
  stats?: { posts?: number; followers?: number; following?: number };
}

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

/** X の URL の見せ方: スキームを外し、長ければ省略記号で切る（実際の表示に寄せる） */
function xUrlLabel(url: string): string {
  const s = url.replace(/^https?:\/\/(www\.)?/, "");
  return s.length > 26 ? `${s.slice(0, 25)}…` : s;
}

/**
 * Instagram のキャプションの切り詰め: 2 行に収まる分だけ残す（「… 続きを読む」の分を空ける）。
 * 幅は全角 1・半角 0.55 で数え、1 行は全角 26 字（393px の端末・14px の文字）。改行は行を進める。
 * 実物は文字ごとの実際の幅で切るので、ここは近似（数文字ずれることがある）。
 */
export function igTruncate(text: string, lead: number, lines = 2, perLine = 26): string | null {
  let line = 0;
  let used = lead;
  const out: string[] = [];
  const budget = (l: number) => (l === lines - 1 ? perLine - 5 : perLine);
  for (const ch of text) {
    if (ch === "\n") {
      line += 1;
      used = 0;
      if (line >= lines) return out.join("").trimEnd();
      out.push(ch);
      continue;
    }
    const w = ch.charCodeAt(0) <= 0xff ? 0.55 : 1;
    if (used + w > budget(line)) {
      line += 1;
      used = 0;
      if (line >= lines) return out.join("").trimEnd();
    }
    used += w;
    out.push(ch);
  }
  return null;
}

/**
 * 本文。ハッシュタグ・メンションは各サービスの色。Instagram の本文の URL はリンクにならない（黒い文字のまま）。
 * Instagram は 2 行で切って「続きを読む」。
 */
export function PostText({
  text: full,
  platform,
  clamp,
}: {
  text: string;
  platform: "instagram" | "x";
  /** Instagram: 2 行で切る。数値は 1 行目の先頭に並ぶユーザー名の幅（全角換算） */
  clamp?: number;
}) {
  const [open, setOpen] = useState(false);
  const cut = clamp !== undefined && !open ? igTruncate(full, clamp) : null;
  const text = cut ?? full;
  const marks = [
    ...extractHashtags(text).map((m) => ({ ...m, kind: "tag" as const })),
    ...extractMentions(text).map((m) => ({ ...m, kind: "tag" as const })),
    ...extractUrls(text).map((m) => ({ ...m, kind: "url" as const })),
  ].sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [i, m] of marks.entries()) {
    if (m.start < at) continue;
    if (m.start > at) parts.push(text.slice(at, m.start));
    const raw = text.slice(m.start, m.end);
    if (m.kind === "url" && platform === "instagram") parts.push(raw);
    else
      parts.push(
        <span key={i} className={m.kind === "url" ? "sp-link" : "sp-tag"}>
          {m.kind === "url" ? xUrlLabel(raw) : raw}
        </span>,
      );
    at = m.end;
  }
  parts.push(text.slice(at));
  return (
    <>
      <span className="sp-text">{parts}</span>
      {cut !== null ? (
        <>
          …{" "}
          <button type="button" className="sp-more" onClick={() => setOpen(true)}>
            続きを読む
          </button>
        </>
      ) : null}
    </>
  );
}

function Avatar({
  account,
  size,
}: {
  account: { displayName: string; username: string; avatar?: string };
  size: number;
}) {
  return (
    <span
      className="sp-avatar"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {account.avatar ? (
        <img src={account.avatar} alt="" />
      ) : (
        Array.from(account.displayName || account.username || "?")[0]
      )}
    </span>
  );
}

const fmtCount = (n: number | undefined) => {
  if (n === undefined) return "—";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return n.toLocaleString("ja-JP");
};

/** 下のタブ（2025 年以降の並び: ホーム・リール・メッセージ・検索・プロフィール） */
function IgTabBar({ account, on }: { account: SocialPost["account"]; on: "home" | "profile" }) {
  return (
    <nav className="sp-ig-tabs" aria-hidden="true">
      <Icon name={on === "home" ? "igHome" : "igHomeOutline"} size={24} />
      <Icon name="igReels" size={24} />
      <Icon name="igShare" size={24} />
      <Icon name="igSearch" size={24} />
      <span className={on === "profile" ? "sp-ig-tabs__me on" : "sp-ig-tabs__me"}>
        <Avatar account={account} size={24} />
      </span>
    </nav>
  );
}

/** フィードの上のバー（新規投稿・ロゴ・お知らせ） */
function IgTopBar() {
  return (
    <header className="sp-ig-top" aria-hidden="true">
      <Icon name="igNewPost" size={24} />
      <span className="sp-ig-top__logo">
        <Icon name="igWordmark" size={29} width={103} />
        <Icon name="igChevronUp" size={12} className="sp-rot180" />
      </span>
      <Icon name="igLike" size={24} />
    </header>
  );
}

function InstagramPost({ post, images }: { post: SocialPost; images: PreviewImage[] }) {
  const [index, setIndex] = useState(0);
  const list = post.images;
  const cur = list[Math.min(index, Math.max(0, list.length - 1))];
  const user = post.account.username || "username";
  return (
    <div className="sp-screen">
      <IgTopBar />
      <div className="sp-scroll" tabIndex={0} aria-label="プレビューの画面">
        <article className="sp-ig">
          <header className="sp-ig__head">
            <span className="sp-ig__ring">
              <Avatar account={post.account} size={32} />
            </span>
            <span className="sp-ig__user">
              {user}
              {post.account.verified ? (
                <Icon
                  name="igVerified"
                  size={12}
                  label="認証済み"
                  className="sp-badge sp-badge--ig"
                />
              ) : null}
            </span>
            <Icon name="igMore" size={24} className="sp-ig__more" />
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
                    <Icon name="igChevronLeft" size={12} />
                  </button>
                ) : null}
                {index < list.length - 1 ? (
                  <button
                    type="button"
                    className="sp-nav sp-nav--next"
                    aria-label="次の画像"
                    onClick={() => setIndex(index + 1)}
                  >
                    <Icon name="igChevronRight" size={12} />
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="sp-ig__actions" aria-hidden="true">
            <Icon name="igLike" />
            <Icon name="igComment" />
            <Icon name="igRepost" />
            <Icon name="igShare" />
            {list.length > 1 ? (
              <span className="sp-ig__pager">
                {list.map((im, i) => (
                  <i key={im.key} className={i === index ? "on" : ""} />
                ))}
              </span>
            ) : null}
            <Icon name="igSave" className="sp-ig__save" />
          </div>
          <p className="sp-ig__caption">
            <b>{user}</b>{" "}
            <PostText
              text={post.body}
              platform="instagram"
              clamp={Array.from(user).length * 0.6 + 1}
            />
          </p>
          <p className="sp-ig__time">1分前</p>
        </article>
        <div className="sp-ig__next" aria-hidden="true">
          <i />
          <span />
        </div>
      </div>
      <IgTabBar account={post.account} on="home" />
    </div>
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
        <div className="sp-story__bars">
          <i />
        </div>
        <div className="sp-story__user">
          <Avatar account={post.account} size={32} />
          <b>{user}</b>
          <span className="sp-story__time">1時間</span>
          <span className="sp-story__icons">
            <Icon name="igMore" size={24} />
            <Icon name="igClose" size={24} />
          </span>
        </div>
      </div>
      <div className="sp-story__bottom" aria-hidden="true">
        <span className="sp-story__reply">メッセージを送信</span>
        <Icon name="igLike" size={24} />
        <Icon name="igShare" size={24} />
      </div>
      {safeArea ? (
        <div className="sp-story__safe" aria-label="安全領域（上 14%・下 20% は UI と重なる目安）">
          <span>上 14%: アカウント名・進行バー</span>
          <span>下 20%: 返信欄</span>
        </div>
      ) : null}
    </div>
  );
}

function InstagramProfile({
  post,
  images,
  profile,
}: {
  post: SocialPost;
  images: PreviewImage[];
  profile?: PreviewProfile | undefined;
}) {
  const account = { ...post.account, ...(profile?.avatar ? { avatar: profile.avatar } : {}) };
  const user = post.account.username || "username";
  const tiles = [...post.images.slice(0, 1), ...Array.from({ length: 11 }, () => null)];
  return (
    <div className="sp-screen">
      <div className="sp-scroll" tabIndex={0} aria-label="プレビューの画面">
        <header className="sp-prof__bar">
          <Icon name="igNewPost" size={24} />
          <span className="sp-prof__bar-title">
            <b>{user}</b>
            {post.account.verified ? (
              <Icon
                name="igVerified"
                size={14}
                label="認証済み"
                className="sp-badge sp-badge--ig"
              />
            ) : null}
            <Icon name="igChevronUp" size={12} className="sp-rot180" />
          </span>
          <Icon name="igMenu" size={24} />
        </header>
        <section className="sp-prof">
          <div className="sp-prof__top">
            <Avatar account={account} size={86} />
            <div className="sp-prof__side">
              <b className="sp-prof__name">{post.account.displayName || user}</b>
              <dl className="sp-prof__stats">
                <div>
                  <dt>{fmtCount(profile?.stats?.posts)}</dt>
                  <dd>投稿</dd>
                </div>
                <div>
                  <dt>{fmtCount(profile?.stats?.followers)}</dt>
                  <dd>フォロワー</dd>
                </div>
                <div>
                  <dt>{fmtCount(profile?.stats?.following)}</dt>
                  <dd>フォロー中</dd>
                </div>
              </dl>
            </div>
          </div>
          {profile?.bio ? <p className="sp-prof__bio">{profile.bio}</p> : null}
          <div className="sp-prof__buttons" aria-hidden="true">
            <span>プロフィールを編集</span>
            <span>プロフィールをシェア</span>
          </div>
        </section>
        <div className="sp-prof__tabs" aria-hidden="true">
          <span className="on">
            <Icon name="igGrid" size={24} />
          </span>
          <span>
            <Icon name="igReels" size={24} />
          </span>
          <span>
            <Icon name="igTagged" size={24} />
          </span>
        </div>
        <div className="sp-grid">
          {tiles.map((t, i) =>
            t ? (
              <div key={i} className="sp-grid__cell">
                <CroppedImage
                  image={images.find((x) => x.key === t.key)}
                  aspect={"3:4" as SocialAspect}
                  focus={t.focus}
                  alt={t.alt}
                  className="sp-grid__tile"
                />
                {post.images.length > 1 ? (
                  <Icon name="igCarousel" size={20} label="カルーセル" className="sp-grid__mark" />
                ) : null}
              </div>
            ) : (
              <div key={i} className="sp-grid__tile sp-grid__tile--empty" aria-hidden="true" />
            ),
          )}
        </div>
      </div>
      <IgTabBar account={account} on="profile" />
    </div>
  );
}

function XPost({
  post,
  images,
  device,
}: {
  post: SocialPost;
  images: PreviewImage[];
  device: PreviewDevice;
}) {
  const user = post.account.username || "username";
  const list = post.images.slice(0, 4);
  const card = (
    <article className="sp-x">
      <Avatar account={post.account} size={40} />
      <div className="sp-x__main">
        <div className="sp-x__head">
          <b className="sp-x__name">{post.account.displayName || "表示名"}</b>
          {post.account.verified ? (
            <Icon
              name="xVerified"
              size={18}
              label="認証済みアカウント"
              className="sp-badge sp-badge--x"
            />
          ) : null}
          <span className="sp-x__meta">@{user}</span>
          <span className="sp-x__time">· 1分</span>
          <Icon name="xMore" size={18} className="sp-x__more" />
        </div>
        <p className="sp-x__text">
          <PostText text={post.body} platform="x" />
        </p>
        {list.length ? (
          <div className={`sp-x__media sp-x__media--${list.length}`}>
            {list.map((im) => (
              <CroppedImage
                key={im.key}
                image={images.find((x) => x.key === im.key)}
                aspect={
                  list.length === 1
                    ? im.aspect
                    : list.length === 2
                      ? ("7:8" as SocialAspect)
                      : "16:9"
                }
                focus={im.focus}
                alt={im.alt}
              />
            ))}
          </div>
        ) : null}
        <div className="sp-x__actions" aria-hidden="true">
          <Icon name="xReply" size={18} />
          <Icon name="xRepost" size={18} />
          <Icon name="xLike" size={18} />
          <Icon name="xViews" size={18} />
          <span className="sp-x__end">
            <Icon name="xBookmark" size={18} />
            <Icon name="xShare" size={18} />
          </span>
        </div>
      </div>
    </article>
  );
  if (device === "pc") return <div className="sp-x-pc">{card}</div>;
  return (
    <div className="sp-screen">
      <header className="sp-x-top" aria-hidden="true">
        <Avatar account={post.account} size={32} />
        <Icon name="xLogo" size={24} className="sp-x-top__logo" />
      </header>
      <div className="sp-x-tabs" aria-hidden="true">
        <span className="on">おすすめ</span>
        <span>フォロー中</span>
      </div>
      <div className="sp-scroll" tabIndex={0} aria-label="プレビューの画面">
        {card}
        <div className="sp-x__next" aria-hidden="true" />
      </div>
      <nav className="sp-x-nav" aria-hidden="true">
        <Icon name="xHome" size={26} />
        <Icon name="xSearch" size={26} />
        <Icon name="xGrok" size={26} />
        <Icon name="xBell" size={26} />
        <Icon name="xMail" size={26} />
      </nav>
      <span className="sp-x-fab" aria-hidden="true">
        <Icon name="xCompose" size={24} />
      </span>
    </div>
  );
}

/** 端末の枠（iPhone / Android / PC）。幅は各端末の CSS ピクセルの代表値（iPhone 16: 393、Pixel: 412） */
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
      {device === "iphone" ? (
        <div className="sp-device__status" aria-hidden="true">
          <b>9:41</b>
          <i className="sp-device__island" />
          <StatusIcons />
        </div>
      ) : device === "android" ? (
        <div className="sp-device__status sp-device__status--android" aria-hidden="true">
          <b>9:41</b>
          <StatusIcons />
        </div>
      ) : null}
      <div className="sp-device__screen">{children}</div>
      {device !== "pc" ? <i className="sp-device__home" aria-hidden="true" /> : null}
    </div>
  );
}

export function PostPreview({
  post,
  images,
  device,
  view,
  safeArea = false,
  profile,
}: {
  post: SocialPost;
  images: PreviewImage[];
  device: PreviewDevice;
  view: PreviewView;
  safeArea?: boolean;
  profile?: PreviewProfile;
}) {
  const story = post.platform === "instagram" && (post.format === "story" || view === "story");
  return (
    <figure className="sp-figure" aria-label="投稿のプレビュー">
      <DeviceFrame device={device} dark={story}>
        {post.platform === "x" ? (
          <XPost post={post} images={images} device={device} />
        ) : story ? (
          <InstagramStory post={post} images={images} safeArea={safeArea} />
        ) : view === "grid" ? (
          <InstagramProfile post={post} images={images} profile={profile} />
        ) : (
          <InstagramPost post={post} images={images} />
        )}
      </DeviceFrame>
      <figcaption className="sp-caption">
        実際の画面に寄せた再現です。折り返し・切り詰め・余白は端末やアプリの版で変わるので、確定の表示は実機で確認してください。
      </figcaption>
    </figure>
  );
}
