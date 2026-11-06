import { z } from "zod";

/**
 * Convex の lib/validators.ts の zod 版。名前は同じ（v → z の違いだけ）で、Convex 側と見比べて直せるようにする。
 * 要る分だけ写す: 関数を移すたびに足す。
 * Convex の v.object は未知の鍵を拒むので、ここも strictObject（patch に id を紛れ込ませる穴を口で塞ぐ）
 */
export const object = z.strictObject;

/** Convex の `v.id("users")` など。ID の実在は application が確かめる（Convex の v.id も形だけ） */
export const vId = z.string();

export const vMediaType = z.enum([
  "pdf",
  "image",
  "document",
  "sns",
  "video",
  "web",
  "figma",
  "other",
]);

/** 大ジャンル（domain の workGenres） */
export const vWorkGenre = z.enum(["graphic", "ui", "video", "text_ja", "text_foreign"]);
/** 小ジャンル（domain の workSubGenres のコード） */
export const vWorkSubGenre = z.enum([
  "digital_sns",
  "digital_web",
  "digital_youtube",
  "digital_other",
  "print_flyer",
  "print_other",
  "print_banner",
  "print_booklet",
  "slide",
  "solid_decoration",
  "print_large",
  "print_decoration",
  "goods",
  "resource_icon",
  "graphic_other",
  "video",
  "pr_text",
  "plan_text",
  "web_copy",
  "form",
  "text_other",
  "web_design",
  "committee_screen",
]);

export const vRegisteredPlanInfo = object({
  name: z.string().optional(),
  number: z.string().optional(),
  venue: z.string().optional(),
  schedule: z.string().optional(),
});

/** 制作物の Notion に揃えた任意の項目（登録・保存の形） */
export const vWorkMetadataFields = {
  genre: vWorkGenre.optional(),
  subGenre: vWorkSubGenre.optional(),
  stakeholderIds: z.array(z.string()).optional(),
  publishAt: z.number().optional(),
  requiresPrinterSubmission: z.boolean().optional(),
  printQuantity: z.number().optional(),
  sizeOrLength: z.string().optional(),
  productionDays: z.number().optional(),
  tags: z.array(z.string()).optional(),
};

/** 同じ項目の変更の形（null で消す） */
export const vWorkMetadataPatch = {
  genre: vWorkGenre.nullable().optional(),
  subGenre: vWorkSubGenre.nullable().optional(),
  stakeholderIds: z.array(z.string()).nullable().optional(),
  publishAt: z.number().nullable().optional(),
  requiresPrinterSubmission: z.boolean().nullable().optional(),
  printQuantity: z.number().nullable().optional(),
  sizeOrLength: z.string().nullable().optional(),
  productionDays: z.number().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
};

export const vRegisteredPlanInfoPatch = vRegisteredPlanInfo.nullable().optional();
