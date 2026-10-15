/**
 * SNS 投稿（Instagram / X）の制作物。版ごとに投稿の内容を固定して校正し、校了後に書き出す（実際の投稿はしない）。
 * - 版の添付: 本文（post-body.txt。範囲指摘・自動校正の対象）・画像（並び順どおり）・内容の記録（mf100-post.json）
 * - プレビューは各サービスの見た目の近似（実際の表示とは異なることがある。画面で明示する）
 * - 文字数の数え方・上限は各サービスの公開情報に基づく近似。運用で変わるので定数にまとめる
 */
export const socialPlatforms = ["instagram", "x"] as const;
export type SocialPlatform = (typeof socialPlatforms)[number];
export const socialPlatformLabels: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  x: "X",
};

export const socialFormats = {
  instagram: ["feed", "carousel", "story"],
  x: ["post"],
} as const satisfies Record<SocialPlatform, readonly string[]>;
export type SocialFormat = (typeof socialFormats)[SocialPlatform][number];
export const socialFormatLabels: Record<SocialFormat, string> = {
  feed: "フィード（1 枚）",
  carousel: "カルーセル（複数枚）",
  story: "ストーリーズ",
  post: "ポスト",
};

/** 画像の切り抜き（プレビューでの表示比率）。original は元の比率 */
export const socialAspects = ["original", "1:1", "4:5", "1.91:1", "9:16", "16:9"] as const;
export type SocialAspect = (typeof socialAspects)[number];

export interface SocialImage {
  /** 投稿内で一意の鍵（並べ替え・ALT の対応に使う） */
  key: string;
  fileName: string;
  /** 代替テキスト（ALT） */
  alt: string;
  aspect: SocialAspect;
  /** 切り抜きの中心（0..1）。未指定は中央 */
  focus?: { x: number; y: number };
  /** 下書き: 前の版で提出済みの画像（添付 ID）。新しく選んだ画像は提出するまで端末の中だけ */
  artifactId?: string;
}

export interface SocialPost {
  version: 1;
  platform: SocialPlatform;
  format: SocialFormat;
  /** 投稿したアカウントの見た目（制作物に割り当てた SNS アカウントから写す。版ごとに固定） */
  account: { displayName: string; username: string; avatar?: string; verified?: boolean };
  body: string;
  images: SocialImage[];
  /** 予定日時（任意。実際の予約投稿はしない） */
  scheduledAt?: number;
}

/** 各サービスの上限（近似）。変わったらここだけ直す。ストーリーズは一度に選べる 10 枚（1 枚ずつ別のストーリーになる） */
export const socialLimits = {
  instagram: { bodyMax: 2200, hashtagsMax: 30, imagesMax: { feed: 1, carousel: 20, story: 10 } },
  x: { weightedMax: 280, imagesMax: 4, urlWeight: 23 },
} as const;

/** 推奨の比率（プレビューの既定） */
export const defaultAspect: Record<SocialFormat, SocialAspect> = {
  feed: "4:5",
  carousel: "1:1",
  story: "9:16",
  post: "16:9",
};

export function emptyPost(platform: SocialPlatform = "instagram"): SocialPost {
  return {
    version: 1,
    platform,
    format: platform === "x" ? "post" : "feed",
    account: { displayName: "", username: "" },
    body: "",
    images: [],
  };
}

const URL_RE = /https?:\/\/[^\s　「」『』（）()<>]+/gu;
/** ハッシュタグ（日本語を含む。数字だけのものは除く） */
const TAG_RE = /(^|[^\p{L}\p{N}_&/])[#＃]([\p{L}\p{M}\p{N}_]*[\p{L}\p{M}_][\p{L}\p{M}\p{N}_]*)/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_])@([A-Za-z0-9_.]{1,30})/gu;

export function extractUrls(text: string): Array<{ start: number; end: number; url: string }> {
  return [...text.matchAll(URL_RE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    url: m[0],
  }));
}

export function extractHashtags(text: string): Array<{ start: number; end: number; tag: string }> {
  return [...text.matchAll(TAG_RE)].map((m) => {
    const start = m.index + m[1]!.length;
    return { start, end: start + 1 + m[2]!.length, tag: m[2]! };
  });
}

export function extractMentions(text: string): Array<{ start: number; end: number; name: string }> {
  return [...text.matchAll(MENTION_RE)].map((m) => {
    const start = m.index + m[1]!.length;
    return { start, end: start + 1 + m[2]!.length, name: m[2]! };
  });
}

/**
 * X の文字数（重み付き・近似）。URL は 23、ASCII・ラテン系などは 1、日本語・中国語・韓国語・絵文字などは 2。
 * 公式の twitter-text の範囲表を簡略化したもの。
 */
export function xWeightedLength(text: string): number {
  let n = 0;
  let rest = text;
  for (const u of extractUrls(text).reverse()) {
    rest = rest.slice(0, u.start) + rest.slice(u.end);
    n += socialLimits.x.urlWeight;
  }
  for (const ch of rest.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    const light =
      c <= 0x10ff ||
      (c >= 0x2000 && c <= 0x200d) ||
      (c >= 0x2010 && c <= 0x201f) ||
      (c >= 0x2032 && c <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** 文字数（コードポイント単位。Instagram の本文） */
export function charLength(text: string): number {
  return Array.from(text).length;
}

export interface PostIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  imageKey?: string;
}

/** 投稿の内容を確かめる（上限は近似。error でも提出は止めず、校正者が判断できるように示す） */
export function checkPost(post: SocialPost): PostIssue[] {
  const issues: PostIssue[] = [];
  const formats = socialFormats[post.platform] as readonly string[];
  if (!formats.includes(post.format))
    issues.push({ level: "error", code: "format", message: "このサービスでは使えない形式です" });
  if (post.platform === "instagram") {
    const lim = socialLimits.instagram;
    const len = charLength(post.body);
    if (len > lim.bodyMax)
      issues.push({
        level: "error",
        code: "body_long",
        message: `本文が ${lim.bodyMax} 文字を超えています（${len} 文字）`,
      });
    const tags = extractHashtags(post.body).length;
    if (tags > lim.hashtagsMax)
      issues.push({
        level: "error",
        code: "hashtags",
        message: `ハッシュタグが ${lim.hashtagsMax} 個を超えています（${tags} 個）`,
      });
    const max = lim.imagesMax[post.format as "feed" | "carousel" | "story"] ?? 1;
    if (post.images.length > max)
      issues.push({
        level: "error",
        code: "images_many",
        message: `画像は ${max} 枚までです（${post.images.length} 枚）`,
      });
    if (post.format === "carousel" && post.images.length < 2)
      issues.push({
        level: "warning",
        code: "carousel_few",
        message: "カルーセルは 2 枚以上で使います",
      });
    if (post.images.length === 0)
      issues.push({
        level: "error",
        code: "images_none",
        message: "Instagram の投稿には画像が必要です",
      });
  } else {
    const len = xWeightedLength(post.body);
    if (len > socialLimits.x.weightedMax)
      issues.push({
        level: "error",
        code: "body_long",
        message: `本文が ${socialLimits.x.weightedMax} を超えています（${len}。日本語は 1 文字 2、URL は 23 で数える近似）`,
      });
    if (post.images.length > socialLimits.x.imagesMax)
      issues.push({
        level: "error",
        code: "images_many",
        message: `画像は ${socialLimits.x.imagesMax} 枚までです`,
      });
  }
  for (const img of post.images)
    if (!img.alt.trim())
      issues.push({
        level: "warning",
        code: "alt_missing",
        message: `${img.fileName} の代替テキスト（ALT）がありません`,
        imageKey: img.key,
      });
  if (!post.account.username.trim())
    issues.push({
      level: "warning",
      code: "username",
      message: "アカウントのユーザー名がありません",
    });
  return issues;
}

/** 切り抜き: 元画像（w×h）に対して、比率 aspect で焦点を中心にした正規化矩形 */
export function cropRect(
  aspect: SocialAspect,
  w: number,
  h: number,
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
): { x: number; y: number; w: number; h: number } {
  if (aspect === "original" || w <= 0 || h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  const [a, b] = aspect.split(":").map(Number) as [number, number];
  const target = a / b;
  const src = w / h;
  if (src > target) {
    const cw = target / src;
    const x = Math.min(Math.max(focus.x - cw / 2, 0), 1 - cw);
    return { x, y: 0, w: cw, h: 1 };
  }
  const ch = src / target;
  const y = Math.min(Math.max(focus.y - ch / 2, 0), 1 - ch);
  return { x: 0, y, w: 1, h: ch };
}

export const POST_MANIFEST_NAME = "mf100-post.json";
export const POST_BODY_NAME = "post-body.txt";

/** 版に添える内容の記録（画像の並び順・ALT・切り抜き・アカウント） */
export function postManifest(post: SocialPost): string {
  return JSON.stringify({ kind: "mf100-post", ...post }, null, 2);
}

/** 記録から投稿を読む（壊れていれば null。外部から来た値なので形を確かめる） */
export function parsePostManifest(json: unknown): SocialPost | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.version !== 1 || !socialPlatforms.includes(o.platform as SocialPlatform)) return null;
  const platform = o.platform as SocialPlatform;
  const formats = socialFormats[platform] as readonly string[];
  const acc = (o.account ?? {}) as Record<string, unknown>;
  const images = Array.isArray(o.images) ? o.images : [];
  return {
    version: 1,
    platform,
    format: (formats.includes(o.format as string) ? o.format : formats[0]) as SocialFormat,
    account: {
      displayName: typeof acc.displayName === "string" ? acc.displayName.slice(0, 100) : "",
      username: typeof acc.username === "string" ? acc.username.slice(0, 50) : "",
      ...(typeof acc.avatar === "string" &&
      acc.avatar.length <= 80_000 &&
      /^data:image\/(png|jpeg|webp);base64,/.test(acc.avatar)
        ? { avatar: acc.avatar }
        : {}),
      ...(acc.verified === true ? { verified: true } : {}),
    },
    body: typeof o.body === "string" ? o.body.slice(0, 10_000) : "",
    images: images.slice(0, 20).flatMap((raw, i) => {
      const im = raw as Record<string, unknown>;
      if (typeof im.fileName !== "string") return [];
      const focus = im.focus as { x?: unknown; y?: unknown } | undefined;
      return [
        {
          key: typeof im.key === "string" ? im.key : `img${i}`,
          fileName: im.fileName,
          alt: typeof im.alt === "string" ? im.alt.slice(0, 1000) : "",
          aspect: socialAspects.includes(im.aspect as SocialAspect)
            ? (im.aspect as SocialAspect)
            : "original",
          ...(typeof im.artifactId === "string" ? { artifactId: im.artifactId } : {}),
          ...(focus && typeof focus.x === "number" && typeof focus.y === "number"
            ? {
                focus: {
                  x: Math.min(1, Math.max(0, focus.x)),
                  y: Math.min(1, Math.max(0, focus.y)),
                },
              }
            : {}),
        },
      ];
    }),
    ...(typeof o.scheduledAt === "number" ? { scheduledAt: o.scheduledAt } : {}),
  };
}

/** 下書きとして保存できる投稿か（文章の下書きと同じ保存先を使う） */
export function isPostDraftContent(content: string): boolean {
  try {
    const o = JSON.parse(content) as { kind?: unknown };
    return o.kind === "mf100-post" && parsePostManifest(o) !== null;
  } catch {
    return false;
  }
}
