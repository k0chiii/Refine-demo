import { DomainError } from "../shared/DomainError.ts";
import type { MediaType } from "./Work.ts";

/**
 * 制作物のメタデータを委員会の Notion「校正システム」の制作物 DB に揃える（利用者決定 2026-10-17。対応表は docs/NOTION_ALIGNMENT.md）。
 * 選択肢（大ジャンル・小ジャンル・タグ・局）は Notion の select / multi_select の選択肢をそのまま写したポリシー値。
 * 内部の値は英字のコードで持ち、表示の名前（Notion の選択肢の名前）はここの表で引く。
 * 業務の判断（どの小ジャンルがどの媒体か等）は利用者が上書きできる既定値であって、規則として確定しない。
 */

// ---------------------------------------------------------------- 大ジャンル（Notion: select）
export const workGenres = ["graphic", "ui", "video", "text_ja", "text_foreign"] as const;
export type WorkGenre = (typeof workGenres)[number];

export const workGenreLabels: Record<WorkGenre, string> = {
  graphic: "グラフィック",
  ui: "ui",
  video: "映像",
  text_ja: "日本語文章",
  text_foreign: "外国語文章",
};

/** 文章の制作物（表記統一の確認項目が出る） */
export function isTextGenre(genre: WorkGenre | undefined | null): boolean {
  return genre === "text_ja" || genre === "text_foreign";
}

// ---------------------------------------------------------------- 小ジャンル（Notion: select。色の組が大ジャンルに対応）
export interface WorkSubGenreDef {
  code: string;
  /** Notion の選択肢の名前そのまま */
  label: string;
  /** Notion の選択肢の色に対応する大ジャンル（橙=グラフィック・緑=ui・紫=映像・青=日本語文章） */
  genre: WorkGenre;
  /** 媒体の既定値（提出・紙面の扱い）。利用者が媒体を選び直してよい */
  mediaType: MediaType;
}

export const workSubGenres = [
  {
    code: "digital_sns",
    label: "デジタル画像（SNS投稿用画像）",
    genre: "graphic",
    mediaType: "sns",
  },
  {
    code: "digital_web",
    label: "デジタル画像（Web関連画像）",
    genre: "graphic",
    mediaType: "image",
  },
  {
    code: "digital_youtube",
    label: "デジタル画像（YouTube）",
    genre: "graphic",
    mediaType: "image",
  },
  { code: "digital_other", label: "デジタル画像（その他）", genre: "graphic", mediaType: "image" },
  { code: "print_flyer", label: "印刷物（紙・ビラ）", genre: "graphic", mediaType: "pdf" },
  { code: "print_other", label: "印刷物（その他）", genre: "graphic", mediaType: "pdf" },
  { code: "print_banner", label: "印刷物（のぼり・ヘッダー）", genre: "graphic", mediaType: "pdf" },
  { code: "print_booklet", label: "印刷物（冊子）", genre: "graphic", mediaType: "pdf" },
  { code: "slide", label: "スライド", genre: "graphic", mediaType: "pdf" },
  { code: "solid_decoration", label: "立体装飾物", genre: "graphic", mediaType: "pdf" },
  { code: "print_large", label: "印刷物（大判印刷物）", genre: "graphic", mediaType: "pdf" },
  { code: "print_decoration", label: "印刷物（装飾物）", genre: "graphic", mediaType: "pdf" },
  { code: "goods", label: "グッズ", genre: "graphic", mediaType: "pdf" },
  { code: "resource_icon", label: "リソース・アイコン", genre: "graphic", mediaType: "image" },
  { code: "graphic_other", label: "その他グラフィック", genre: "graphic", mediaType: "image" },
  { code: "video", label: "映像", genre: "video", mediaType: "video" },
  { code: "pr_text", label: "広報文", genre: "text_ja", mediaType: "document" },
  { code: "plan_text", label: "企画詳細文", genre: "text_ja", mediaType: "document" },
  { code: "web_copy", label: "web原稿", genre: "text_ja", mediaType: "document" },
  { code: "form", label: "フォーム", genre: "text_ja", mediaType: "document" },
  { code: "text_other", label: "その他文章", genre: "text_ja", mediaType: "document" },
  { code: "web_design", label: "webデザイン", genre: "ui", mediaType: "web" },
  { code: "committee_screen", label: "委員会システム画面", genre: "ui", mediaType: "figma" },
] as const satisfies readonly WorkSubGenreDef[];
export type WorkSubGenre = (typeof workSubGenres)[number]["code"];

export const workSubGenreCodes = workSubGenres.map((s) => s.code) as readonly WorkSubGenre[];

export function subGenreDef(code: string | undefined | null): WorkSubGenreDef | null {
  return workSubGenres.find((s) => s.code === code) ?? null;
}

export function workSubGenreLabel(code: string | undefined | null): string | null {
  return subGenreDef(code)?.label ?? null;
}

/** 小ジャンルの既定の大ジャンル（Notion の選択肢の色の組） */
export function genreOfSubGenre(code: string | undefined | null): WorkGenre | null {
  return subGenreDef(code)?.genre ?? null;
}

/** 大ジャンルごとの小ジャンル（選択欄の option group） */
export function subGenresOf(genre: WorkGenre): WorkSubGenreDef[] {
  return workSubGenres.filter((s) => s.genre === genre);
}

/** 小ジャンル「スライド」（PDF 校正 + スライド URL のセット提出） */
export function isSlideSubGenre(subGenre: string | undefined | null): boolean {
  return subGenre === "slide";
}

/** 大ジャンルだけが分かるときの媒体の既定値 */
const genreMediaType: Record<WorkGenre, MediaType> = {
  graphic: "image",
  ui: "web",
  video: "video",
  text_ja: "document",
  text_foreign: "document",
};

/**
 * 小ジャンル（無ければ大ジャンル）から媒体の既定値を決める。どちらも無ければ null（利用者が選ぶ）。
 * 媒体はこのアプリの提出・紙面の扱い（PDF の紙面・SNS の投稿編集・動画・Web のライブ表示・Figma）なので、
 * Notion の分類から自動で決めつつ、利用者が選び直せる（登録・編集・CSV）。
 */
export function defaultMediaTypeFor(
  subGenre: string | undefined | null,
  genre?: string | null,
): MediaType | null {
  const sub = subGenreDef(subGenre);
  if (sub) return sub.mediaType;
  if (genre && (workGenres as readonly string[]).includes(genre))
    return genreMediaType[genre as WorkGenre];
  return null;
}

/** Notion の選択肢の名前（表記のゆれは NFKC・空白を無視）→ 大ジャンルのコード。内部のコードも通す */
export function parseWorkGenre(text: string): WorkGenre | null {
  const key = optionKey(text);
  if (key === "") return null;
  for (const g of workGenres)
    if (optionKey(g) === key || optionKey(workGenreLabels[g]) === key) return g;
  return null;
}

/** Notion の選択肢の名前 → 小ジャンルのコード。内部のコードも通す */
export function parseWorkSubGenre(text: string): WorkSubGenre | null {
  const key = optionKey(text);
  if (key === "") return null;
  for (const s of workSubGenres)
    if (optionKey(s.code) === key || optionKey(s.label) === key) return s.code;
  return null;
}

/** 選択肢の照合用（全角英数・括弧のゆれ・空白・大文字小文字を無視） */
export function optionKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

// ---------------------------------------------------------------- タグ（Notion: multi_select）
/** Notion にある選択肢（候補として出す。これ以外のタグも付けられる） */
export const workTagOptions = [
  "a",
  "b",
  "マスター",
  "流し込み",
  "公式パンフ",
  "1次公開",
  "2次公開",
  "art_好きあつめ",
  "art_屋内",
  "art_web",
] as const;
export const WORK_TAG_MAX = 20;
export const WORK_TAG_LENGTH_MAX = 30;

/** タグを整える: 前後の空白を除き、空と重なりを除く。長すぎる・多すぎるは work_invalid */
export function normalizeWorkTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.normalize("NFKC").trim();
    if (t === "") continue;
    if (Array.from(t).length > WORK_TAG_LENGTH_MAX)
      throw new DomainError("work_invalid", {
        field: "tags",
        reason: "too_long",
        max: WORK_TAG_LENGTH_MAX,
      });
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > WORK_TAG_MAX)
    throw new DomainError("work_invalid", { field: "tags", reason: "too_many", max: WORK_TAG_MAX });
  return out;
}

// ---------------------------------------------------------------- リンク・ID
/** 0 以上の整数（部数・制作日数）。空は null、読めなければ undefined */
export function parseNonNegativeInteger(text: string): number | null | undefined {
  const v = text
    .normalize("NFKC")
    .replace(/[,，]/g, "")
    .trim();
  if (v === "") return null;
  if (!/^\d{1,9}$/.test(v)) return undefined;
  return Number(v);
}

export const WORK_SIZE_MAX = 100;

// ---------------------------------------------------------------- 版の提出時の自己確認（Notion: 版 DB のチェックボックス）
/**
 * 申告（3 つ）: 品質の確認ではなく「使っているか」の宣言。版に記録し、制作物の「現在の版」の値として見せる
 * （Notion の 写真の使用／めいの使用／デザイン指針外の色の使用 の formula に相当）。
 */
export interface RevisionDeclarations {
  /** 写真の使用 */
  usesPhotos: boolean;
  /** めい（公式キャラクター）の使用 */
  usesMascot: boolean;
  /** デザイン指針外の色の使用 */
  usesOffPaletteColors: boolean;
}

export const revisionDeclarationItems: ReadonlyArray<{
  key: keyof RevisionDeclarations;
  label: string;
  /** 申告したら勧める専門確認の種別 */
  suggestsCheck?: "photo" | "design";
}> = [
  { key: "usesPhotos", label: "写真の使用", suggestsCheck: "photo" },
  { key: "usesMascot", label: "めいの使用" },
  { key: "usesOffPaletteColors", label: "デザイン指針外の色の使用", suggestsCheck: "design" },
];

export const emptyDeclarations: RevisionDeclarations = {
  usesPhotos: false,
  usesMascot: false,
  usesOffPaletteColors: false,
};

/** 申告から勧める専門確認の種別（写真の使用 → 写真、指針外の色 → デザイン） */
export function suggestedChecksFor(d: Partial<RevisionDeclarations>): Array<"photo" | "design"> {
  return revisionDeclarationItems.flatMap((it) =>
    d[it.key] && it.suggestsCheck ? [it.suggestsCheck] : [],
  );
}

/** 提出前の確認項目（Notion の版 DB のチェックボックス。文章の制作物だけの項目は textOnly） */
export const submissionChecklist = [
  { id: "theme_font", label: "テーマフォントを使用しているか" },
  { id: "balance", label: "サイズ、位置、色のバランスなどは適切ですか？" },
  {
    id: "committee_output",
    label: "個人ではなく委員会のアウトプットであることは意識できていますか？",
  },
  {
    id: "intent_comment",
    label:
      "制作方針と校正者に求めていること（迷っている点や特にこだわっている部分など）がわかるようにコメントしていますか？",
  },
  {
    id: "notation_checked",
    label: "（文章制作物のみ）表記統一システムを通し、表記統一と異なる表記は適宜修正していますか？",
    textOnly: true,
  },
] as const;
export type SubmissionCheckId = (typeof submissionChecklist)[number]["id"];

/** この制作物の提出に出す確認項目（文章の制作物でなければ文章だけの項目を除く） */
export function checklistFor(genre: WorkGenre | undefined | null) {
  return submissionChecklist.filter((c) => !("textOnly" in c && c.textOnly) || isTextGenre(genre));
}

/** 確認した項目の ID を整える（知らない ID は捨てる・重複を除く） */
export function normalizeSelfChecks(ids: readonly string[]): SubmissionCheckId[] {
  const known = new Set<string>(submissionChecklist.map((c) => c.id));
  return Array.from(new Set(ids.filter((id) => known.has(id)))) as SubmissionCheckId[];
}

/**
 * 制作物の「現在の版」の申告（Notion の formula に相当）: void でない最新の版（0版を含む）の申告。
 * 申告の無い古い版なら null
 */
export function currentDeclarations<
  R extends {
    kind: "rough" | "standard";
    sequence: number;
    reviewState: string;
    submittedAt: number;
    declarations?: RevisionDeclarations | undefined;
  },
>(revisions: readonly R[]): RevisionDeclarations | null {
  const live = revisions.filter((r) => r.reviewState !== "void");
  if (live.length === 0) return null;
  const latest = live.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
  return latest.declarations ?? null;
}
