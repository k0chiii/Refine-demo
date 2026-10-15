import {
  cropRect,
  extractHashtags,
  extractMentions,
  extractUrls,
  type SocialAspect,
  type SocialPost,
} from "@mf100/domain";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { bezelUrl, deviceById, outerSize, type DeviceSpec } from "./devices";
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
/** 端末の ID（devices.ts の DEVICES） */
export type PreviewDevice = string;
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

/**
 * 横に並べた枠をスクロールスナップで 1 枚ずつ送る（カルーセル・ストーリーズ共通）。
 * - タッチ・トラックパッドはブラウザのスクロールに任せる。マウスはドラッグで送る（離すと動かした向きへ 1 枚）
 * - 枚数が減ったら範囲内に戻す
 */
function useSnapTrack(count: number, index: number, onIndex: (i: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  /** 直前の操作がドラッグだったか（ドラッグの後の click で送らないため） */
  const dragged = useRef(false);
  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ left: Math.min(count - 1, Math.max(0, i)) * el.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    if (index > count - 1) {
      onIndex(Math.max(0, count - 1));
      const el = ref.current;
      if (el) el.scrollLeft = 0;
    }
  }, [count]);
  const drag = useRef<{ x: number; left: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragged.current = false;
    if (e.pointerType !== "mouse" || e.button !== 0 || count < 2) return;
    const el = e.currentTarget;
    drag.current = { x: e.clientX, left: el.scrollLeft, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    el.classList.add("is-dragging");
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // 端末の枠は transform で縮めて表示しているので、画面上の移動量を枠の中の量に直す
    const el = e.currentTarget;
    const k = el.getBoundingClientRect().width / el.clientWidth || 1;
    el.scrollLeft = d.left - (e.clientX - d.x) / k;
    if (Math.abs(e.clientX - d.x) > 4) dragged.current = true;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const el = e.currentTarget;
    const moved = el.scrollLeft - d.left;
    const w = el.clientWidth;
    // 少し動かしただけでも、動かした向きに 1 枚送る（Instagram の払い方に近づける）
    const from = Math.round(d.left / w);
    go(Math.abs(moved) > w * 0.15 ? from + Math.sign(moved) : from);
    // スナップを先に戻すと、なめらかに送る前に近い 1 枚へ引き戻されるので、送り終えてから戻す
    const done = () => el.classList.remove("is-dragging");
    if ("onscrollend" in el) el.addEventListener("scrollend", done, { once: true });
    window.setTimeout(done, 600);
  };
  return {
    go,
    dragged,
    props: {
      ref,
      onScroll: (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        if (i !== index) onIndex(i);
      },
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

/**
 * Instagram のカルーセル: 横に並べてスクロールスナップで 1 枚ずつ送る（実機と同じく指で払える）。
 * - 枠の比率は 1 枚目に合わせる（Instagram はカルーセル全体を 1 枚目の比率で切り抜く）。各画像は自分の焦点で切り抜く
 * - 矢印は PC の Instagram と同じ。マウスはドラッグでも送れる（タッチ・トラックパッドはブラウザのスクロールに任せる）
 */
function IgCarousel({
  post,
  images,
  index,
  onIndex,
}: {
  post: SocialPost;
  images: PreviewImage[];
  index: number;
  onIndex: (i: number) => void;
}) {
  const list = post.images;
  const first = list[0];
  const firstImage = images.find((i) => i.key === first?.key);
  // 1 枚目が「元の比率」なら、その画像の縦横を比率として残りにも使う
  const frame = (
    first?.aspect === "original" && firstImage
      ? `${firstImage.w}:${firstImage.h}`
      : (first?.aspect ?? "1:1")
  ) as SocialAspect;
  const snap = useSnapTrack(list.length, index, onIndex);
  return (
    <>
      <div
        {...snap.props}
        className="sp-ig__track"
        // キーボードでも送れるように（フォーカスして左右の矢印キー）
        tabIndex={0}
        role="region"
        aria-roledescription="カルーセル"
        aria-label="投稿の画像（左右に送る）"
      >
        {list.length ? (
          list.map((im, i) => (
            <div
              key={im.key}
              className="sp-ig__slide"
              role="group"
              aria-roledescription="スライド"
              aria-label={`${i + 1} / ${list.length}`}
            >
              <CroppedImage
                image={images.find((x) => x.key === im.key)}
                aspect={frame}
                focus={im.focus}
                alt={im.alt}
              />
            </div>
          ))
        ) : (
          <div className="sp-ig__slide">
            <CroppedImage image={undefined} aspect={frame} alt="" />
          </div>
        )}
      </div>
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
              onClick={() => snap.go(index - 1)}
            >
              <Icon name="igChevronLeft" size={12} />
            </button>
          ) : null}
          {index < list.length - 1 ? (
            <button
              type="button"
              className="sp-nav sp-nav--next"
              aria-label="次の画像"
              onClick={() => snap.go(index + 1)}
            >
              <Icon name="igChevronRight" size={12} />
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );
}

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
 * 幅は全角 1・半角 0.55 で数え、1 行は（画面の幅 − 左右の余白 24px）÷ 14px の字数（393px の端末で 26 字）。改行は行を進める。
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
  perLine,
}: {
  text: string;
  platform: "instagram" | "x";
  /** Instagram: 2 行で切る。数値は 1 行目の先頭に並ぶユーザー名の幅（全角換算） */
  clamp?: number;
  /** 1 行に入る全角の字数（画面の幅から計算） */
  perLine?: number;
}) {
  const [open, setOpen] = useState(false);
  const cut = clamp !== undefined && !open ? igTruncate(full, clamp, 2, perLine) : null;
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

function InstagramPost({
  post,
  images,
  width,
}: {
  post: SocialPost;
  images: PreviewImage[];
  /** 画面の幅（キャプションの切り詰めに使う） */
  width: number;
}) {
  const [index, setIndex] = useState(0);
  const list = post.images;
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
            <IgCarousel post={post} images={images} index={index} onIndex={setIndex} />
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
              perLine={Math.floor((width - 24) / 14)}
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
  const list = post.images;
  const [index, setIndex] = useState(0);
  const snap = useSnapTrack(list.length, index, setIndex);
  const user = post.account.username || "username";
  return (
    <div className="sp-story">
      {/* 1 枚ずつ別のストーリー。払って送る・左 1/3 を押すと戻る・それ以外を押すと次へ（Instagram と同じ） */}
      <div
        {...snap.props}
        className="sp-story__track"
        tabIndex={0}
        role="region"
        aria-roledescription="ストーリーズ"
        aria-label={`ストーリーズ（${Math.min(index + 1, Math.max(1, list.length))} / ${Math.max(1, list.length)}。左右に送る）`}
        onClick={(e) => {
          if (snap.dragged.current || list.length < 2) return;
          const r = e.currentTarget.getBoundingClientRect();
          snap.go(e.clientX - r.left < r.width / 3 ? index - 1 : index + 1);
        }}
      >
        {(list.length ? list : [undefined]).map((im, i) => (
          <div key={im?.key ?? i} className="sp-story__slide">
            <CroppedImage
              image={im ? images.find((x) => x.key === im.key) : undefined}
              aspect="9:16"
              focus={im?.focus}
              alt={im?.alt ?? ""}
            />
          </div>
        ))}
      </div>
      <div className="sp-story__top">
        <div className="sp-story__bars">
          {(list.length ? list : [undefined]).map((im, i) => (
            <i key={im?.key ?? i} className={i <= index ? "on" : ""} />
          ))}
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

function XPost({ post, images, pc }: { post: SocialPost; images: PreviewImage[]; pc: boolean }) {
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
  if (pc) return <div className="sp-x-pc">{card}</div>;
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

/** 画面（実機の CSS ピクセルの大きさ）。ステータスバー・切り欠き・ホームインジケーターを含む */
function DeviceScreen({
  spec,
  dark,
  drawCutout,
  children,
}: {
  spec: DeviceSpec;
  dark: boolean;
  drawCutout: boolean;
  children: ReactNode;
}) {
  const pc = spec.kind === "pc";
  const style = pc
    ? undefined
    : ({
        width: spec.w,
        height: spec.h,
        borderRadius: spec.radius,
        "--sp-top": `${spec.top}px`,
        "--sp-bottom": `${spec.bottom}px`,
      } as CSSProperties);
  return (
    <div
      className={`sp-device sp-device--${spec.kind} sp-cut--${spec.cutout} ${dark ? "sp-device--dark" : ""}`}
      style={style}
    >
      {pc ? null : (
        <div className="sp-device__status" aria-hidden="true">
          <b>9:41</b>
          <StatusIcons />
        </div>
      )}
      {drawCutout && spec.cutout === "island" ? (
        <i className="sp-device__island" aria-hidden="true" />
      ) : null}
      {spec.cutout === "notch" ? <i className="sp-device__notch" aria-hidden="true" /> : null}
      {spec.cutout === "punch" ? <i className="sp-device__punch" aria-hidden="true" /> : null}
      <div className="sp-device__screen">{children}</div>
      {spec.bottom > 0 ? <i className="sp-device__home" aria-hidden="true" /> : null}
    </div>
  );
}

/**
 * 端末の外形。iPhone は Apple の公式ベゼル画像を画面の上に重ね、それ以外は CSS で枠を描く。
 * 中の画面は実機と同じ CSS ピクセルで組むので、文字の折り返しは実機と同じになる（表示だけ縮める）。
 */
function DeviceFrame({
  spec,
  color,
  dark,
  children,
}: {
  spec: DeviceSpec;
  color?: string | undefined;
  dark: boolean;
  children: ReactNode;
}) {
  const bezel = bezelUrl(spec, color);
  if (spec.kind === "pc")
    return (
      <DeviceScreen spec={spec} dark={dark} drawCutout={false}>
        {children}
      </DeviceScreen>
    );
  const outer = outerSize(spec);
  const home = spec.cutout === "home-button";
  const at = spec.bezel
    ? { left: spec.bezel.x, top: spec.bezel.y }
    : { left: 12, top: home ? 72 : 12 };
  return (
    <div
      className={`sp-frame sp-frame--${spec.kind} ${bezel ? "sp-frame--bezel" : ""}`}
      style={{ width: outer.w, height: outer.h }}
    >
      {bezel ? null : (
        <i
          className="sp-frame__body"
          style={{ borderRadius: home ? 56 : spec.radius + 12 }}
          aria-hidden="true"
        >
          {home ? (
            <>
              <i className="sp-frame__speaker" />
              <i className="sp-frame__button" />
            </>
          ) : null}
        </i>
      )}
      <div className="sp-frame__screen" style={at}>
        <DeviceScreen spec={spec} dark={dark} drawCutout={!bezel}>
          {children}
        </DeviceScreen>
      </div>
      {bezel ? <img className="sp-frame__bezel" src={bezel} alt="" draggable={false} /> : null}
    </div>
  );
}

/** 置き場所の幅と画面の高さに収まるように縮める倍率（拡大はしない） */
function useFitScale(outer: { w: number; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || outer.h === 0) {
      setScale(1);
      return;
    }
    const fit = () => {
      const w = el.parentElement?.clientWidth ?? el.clientWidth;
      // 上のツールバー（端末の選択など）とアプリバーの分を引いた高さに収める
      const h = Math.max(520, window.innerHeight - 240);
      setScale(Math.min(1, w / outer.w, h / outer.h));
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (ro && el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [outer.w, outer.h]);
  return { ref, scale };
}

const isStory = (post: SocialPost, view: PreviewView) =>
  post.platform === "instagram" && (post.format === "story" || view === "story");

/** 画面の中身（サービス・形式・表示に応じた模擬画面） */
function PreviewContent({
  post,
  images,
  view,
  safeArea,
  profile,
  width,
  pc,
}: {
  post: SocialPost;
  images: PreviewImage[];
  view: PreviewView;
  safeArea: boolean;
  profile?: PreviewProfile | undefined;
  width: number;
  pc: boolean;
}) {
  if (post.platform === "x") return <XPost post={post} images={images} pc={pc} />;
  if (isStory(post, view))
    return <InstagramStory post={post} images={images} safeArea={safeArea} />;
  if (view === "grid") return <InstagramProfile post={post} images={images} profile={profile} />;
  return <InstagramPost post={post} images={images} width={width} />;
}

/**
 * 全画面のプレビュー（スマホ向け。利用者指示 2026-10-15）: 枠を描かず、見ている端末の画面いっぱいに模擬画面を出す。
 * 端末のステータスバー・ホームインジケーターは本物をそのまま使い、その分（セーフエリア）だけ中身を内側に置くので、
 * 自分のスマホにそのアプリが入っているように見える。使えるときは Fullscreen API でブラウザのバーも隠す。
 * 閉じる: 右上の ✕・Esc・戻る操作（履歴を 1 つ積む）。
 */
export function FullscreenPreview({
  post,
  images,
  view,
  safeArea = false,
  profile,
  onClose,
}: {
  post: SocialPost;
  images: PreviewImage[];
  view: PreviewView;
  safeArea?: boolean;
  profile?: PreviewProfile;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 393 : innerWidth));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    // 使える環境（Android の Chrome など）ではブラウザのバーも隠す。iPhone の Safari は要素の全画面に対応しない
    void el?.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);
    // 戻る操作で閉じる
    history.pushState({ mf100Preview: true }, "");
    let closedByBack = false;
    const onPop = () => {
      closedByBack = true;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    const onResize = () => setWidth(innerWidth);
    addEventListener("popstate", onPop);
    addEventListener("keydown", onKey);
    addEventListener("resize", onResize);
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      removeEventListener("popstate", onPop);
      removeEventListener("keydown", onKey);
      removeEventListener("resize", onResize);
      document.documentElement.style.overflow = prevOverflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      if (!closedByBack && history.state?.mf100Preview) history.back();
    };
  }, []);
  const story = isStory(post, view);
  return createPortal(
    <div
      ref={ref}
      className="sp-full"
      role="dialog"
      aria-modal="true"
      aria-label="投稿のプレビュー（全画面）"
    >
      <div
        className={`sp-device sp-device--iphone sp-full__screen ${story ? "sp-device--dark" : ""}`}
        style={
          {
            "--sp-top": "env(safe-area-inset-top, 0px)",
            "--sp-bottom": "env(safe-area-inset-bottom, 0px)",
          } as CSSProperties
        }
      >
        {/* 本物のステータスバーの分だけ空ける（時計・電波は端末のものが見える） */}
        <div className="sp-full__status" aria-hidden="true" />
        <div className="sp-device__screen">
          <PreviewContent
            post={post}
            images={images}
            view={view}
            safeArea={safeArea}
            profile={profile}
            width={width}
            pc={false}
          />
        </div>
      </div>
      <button
        type="button"
        className="sp-full__close"
        aria-label="全画面のプレビューを閉じる"
        onClick={onClose}
      >
        <Icon name="igClose" size={18} />
      </button>
    </div>,
    document.body,
  );
}

export function PostPreview({
  post,
  images,
  device,
  color,
  view,
  safeArea = false,
  profile,
}: {
  post: SocialPost;
  images: PreviewImage[];
  device: PreviewDevice;
  /** ベゼルの色（iPhone） */
  color?: string;
  view: PreviewView;
  safeArea?: boolean;
  profile?: PreviewProfile;
}) {
  const spec = deviceById(device);
  const outer = outerSize(spec);
  const { ref, scale } = useFitScale(outer);
  const story = isStory(post, view);
  return (
    <figure className="sp-figure" aria-label="投稿のプレビュー">
      <div className="sp-frame-fit" ref={ref} style={scale < 1 ? { zoom: scale } : undefined}>
        <DeviceFrame spec={spec} color={color} dark={story}>
          <PreviewContent
            post={post}
            images={images}
            view={view}
            safeArea={safeArea}
            profile={profile}
            width={spec.w}
            pc={spec.kind === "pc"}
          />
        </DeviceFrame>
      </div>
      <figcaption className="sp-caption">
        {spec.kind === "pc"
          ? null
          : `${spec.label}（画面 ${spec.w}×${spec.h}${scale < 1 ? `、実寸の ${Math.round(scale * 100)}% で表示` : ""}）。`}
        実際の画面に寄せた再現です。折り返し・切り詰め・余白は端末やアプリの版で変わるので、確定の表示は実機で確認してください。
      </figcaption>
    </figure>
  );
}
