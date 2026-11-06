import { z } from "zod";

/**
 * Convex の lib/validators.ts の zod 版。名前は同じ（v → z の違いだけ）で、Convex 側と見比べて直せるようにする。
 * Convex の v.object は未知の鍵を拒むので、ここも strictObject（patch に id を紛れ込ませる穴を口で塞ぐ）
 */
export const object = z.strictObject;

/** Convex の `v.id("users")` など。ID の実在は application が確かめる（Convex の v.id も形だけ） */
export const vId = z.string();

/**
 * アバター（Humation）の設定（me.setAvatar の引数）。形の検証と正規化は domain の validateAvatarConfig。
 * 部位・色の役割は domain `AVATAR_PART_SLOTS` / `AVATAR_COLOR_SLOTS` と同じ
 */
export const vAvatarConfig = object({
  seed: z.string().optional(),
  selections: object({
    head: z.string().optional(),
    body: z.string().optional(),
    item: z.string().optional(),
    glasses: z.string().optional(),
  }).optional(),
  colors: object({
    hair: z.string().optional(),
    skin: z.string().optional(),
    clothes: z.string().optional(),
    stroke: z.string().optional(),
  }).optional(),
  background: z.string().optional(),
});
/** 保存済みのアバター。外した部位（`bottom`）が残る古い値も読めるよう、部位・役割の名前は限定しない */
export const vStoredAvatarConfig = object({
  seed: z.string().optional(),
  selections: z.record(z.string(), z.string()).optional(),
  colors: z.record(z.string(), z.string()).optional(),
  background: z.string().optional(),
});

export const vPermissionLevel = z.enum(["review", "edit", "manage"]);
export const vPrincipalType = z.enum(["user", "group"]);
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

// ---------------------------------------------------------------- Notion の制作物 DB・版 DB・担当 DB に揃えた項目（docs/NOTION_ALIGNMENT.md）
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

/** 版の提出時の申告（写真・めい・指針外の色の使用） */
export const vRevisionDeclarations = object({
  usesPhotos: z.boolean(),
  usesMascot: z.boolean(),
  usesOffPaletteColors: z.boolean(),
});
/** 局のコード（domain の bureauCodes） */
export const vBureauCode = z.enum(["JIM", "ZAI", "SSK", "EVE", "PR", "SYS", "WG", "CAP"]);
export const vRevisionKind = z.enum(["rough", "standard"]);
export const vArtifactRole = z.enum(["source", "preview", "external"]);
export const vArtifactType = z.enum([
  "pdf",
  "image",
  "document",
  "video",
  "other",
  "external_link",
]);
/** 添付の由来（Figma から取り込んだ・サイトのスクリーンショット）。domain の ArtifactOrigin と同じ形 */
export const vArtifactOrigin = z.discriminatedUnion("kind", [
  object({
    kind: z.literal("figma"),
    fileKey: z.string(),
    nodeId: z.string(),
    nodeName: z.string().optional(),
    figmaVersion: z.string().optional(),
    lastModified: z.string().optional(),
    scale: z.number(),
    box: object({ width: z.number(), height: z.number() }),
  }),
  object({
    kind: z.literal("web_snapshot"),
    url: z.string(),
    deviceId: z.string().optional(),
    viewport: object({
      width: z.number(),
      height: z.number(),
      dpr: z.number(),
      orientation: z.enum(["portrait", "landscape"]),
    }),
    userAgent: z.string().optional(),
    fullPage: z.boolean(),
    capturedAt: z.number(),
  }),
]);
/** Figma から取り込んだときに Figma の応答から埋める値（検証完了に添える） */
export const vFigmaImportMeta = object({
  nodeName: z.string(),
  figmaVersion: z.string().optional(),
  lastModified: z.string().optional(),
  box: object({ width: z.number(), height: z.number() }),
});
export const vThreadKind = z.enum(["correction", "question", "discussion", "decision"]);
export const vSeverity = z.enum(["critical", "major", "minor", "info"]);
export const vDecision = z.enum(["acknowledged", "accepted", "rejected", "deferred", "resolved"]);
export const vLifecycleTarget = z.enum(["draft", "active", "on_hold", "cancelled"]);
export const vCheckType = z.enum(["photo", "name", "language", "rules", "design", "other"]);

// ---------------------------------------------------------------- コメントの位置（Convex は schema.ts の anchorValidator）
const rect = object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const point = object({ x: z.number(), y: z.number() });
export const vAnchor = z.discriminatedUnion("type", [
  object({ type: z.literal("pdf_rect"), artifactId: z.string(), page: z.number(), rect }),
  object({ type: z.literal("pdf_pin"), artifactId: z.string(), page: z.number(), point }),
  object({ type: z.literal("image_rect"), artifactId: z.string(), rect }),
  object({ type: z.literal("image_pin"), artifactId: z.string(), point }),
  object({ type: z.literal("external"), artifactId: z.string(), note: z.string() }),
  object({
    type: z.literal("text_range"),
    artifactId: z.string(),
    start: z.number(),
    end: z.number(),
    quote: z.string(),
  }),
  object({
    type: z.literal("video_time"),
    artifactId: z.string(),
    start: z.number(),
    end: z.number().optional(),
    rect: rect.optional(),
    point: point.optional(),
  }),
  // Web のライブ表示の要素（docs/FIGMA_WEB_PROOFING.md §6.1）
  object({
    type: z.literal("web_element"),
    artifactId: z.string(),
    url: z.string(),
    selector: object({
      css: z.string(),
      xpath: z.string().optional(),
      textQuote: object({
        exact: z.string(),
        prefix: z.string().optional(),
        suffix: z.string().optional(),
      }).optional(),
      tag: z.string(),
    }),
    rect: rect.optional(),
    point: point.optional(),
    viewport: object({
      width: z.number(),
      height: z.number(),
      dpr: z.number(),
      deviceId: z.string().optional(),
      orientation: z.enum(["portrait", "landscape"]),
    }),
    fallback: object({ pageX: z.number(), pageY: z.number(), scrollY: z.number() }),
  }),
  // Figma の埋め込み表示のフレーム（位置は取れないのでノード単位）
  object({
    type: z.literal("figma_node"),
    artifactId: z.string(),
    fileKey: z.string(),
    nodeId: z.string(),
    nodeName: z.string().optional(),
  }),
]);

// ---------------------------------------------------------------- 表記統一
export const vRuleException = object({
  kind: z.enum(["phrase", "before", "after", "category"]),
  value: z.string(),
  note: z.string().optional(),
});
export const vRuleDraftFields = {
  ruleId: z.string(),
  categoryCode: z.string(),
  title: z.string(),
  description: z.string(),
  correct: z.array(z.string()),
  incorrect: z.array(z.string()),
  patterns: z.array(z.string()),
  exceptions: z.array(vRuleException),
  language: z.enum(["ja", "en", "zh"]),
  scopes: z.array(z.string()),
  years: z.array(z.number()),
  priority: z.number(),
  strictness: z.enum(["required", "recommended", "review"]),
  enabled: z.boolean(),
  note: z.string().optional(),
  translations: object({ en: z.string().optional(), zh: z.string().optional() }).optional(),
};
export const vRuleDraft = object(vRuleDraftFields);
export const vRuleFields = {
  ...vRuleDraftFields,
  revision: z.number(),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  publishedAt: z.number().optional(),
};
export const vRuleCategoryFields = {
  code: z.string(),
  name: z.string(),
  description: z.string(),
  parents: z.array(z.string()),
  policyNotes: z.string(),
  order: z.number(),
};
export const vRuleSetSnapshot = object({
  categories: z.array(z.string()),
  year: z.number(),
  // depth: 提出時の継承の深さ（古い版の記録には無い）
  rules: z.array(
    object({ ruleId: z.string(), revision: z.number(), depth: z.number().optional() }),
  ),
  hash: z.string(),
});
export const vProposalKind = z.enum(["new", "change", "report"]);
export const vProposalStatus = z.enum(["open", "approved", "rejected"]);
export const vProposalContext = object({
  workId: z.string().optional(),
  revisionId: z.string().optional(),
  artifactId: z.string().optional(),
  quote: z.string().optional(),
  surrounding: z.string().optional(),
});

// ---------------------------------------------------------------- 自動校正
export const vTextSource = z.enum(["document", "pdf_text", "ocr"]);
export const vBotOrigin = object({
  kind: z.literal("bot"),
  detector: z.enum(["rule", "morphology", "ocr", "ai"]),
  ruleId: z.string(),
  ruleRevision: z.number(),
  runId: z.string(),
  fingerprint: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  needsReview: z.boolean(),
  original: z.string(),
  suggestion: z.string(),
  textSource: vTextSource,
});
const vRect = object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const vTextBox = object({ start: z.number(), end: z.number(), rect: vRect });
export const vProofreadSegment = z.discriminatedUnion("kind", [
  object({ kind: z.literal("text"), text: z.string() }),
  object({
    kind: z.literal("page"),
    page: z.number(),
    text: z.string(),
    boxes: z.array(vTextBox),
    ocrConfidence: z.number().optional(),
  }),
  object({
    kind: z.literal("image"),
    text: z.string(),
    boxes: z.array(vTextBox),
    confidence: z.number(),
  }),
]);
const vRunStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export const vProofreadingRunFields = {
  workId: z.string(),
  revisionId: z.string(),
  status: vRunStatus,
  snapshotHash: z.string(),
  artifacts: z.array(
    object({
      artifactId: z.string(),
      status: vRunStatus,
      findings: z.number(),
      source: vTextSource.optional(),
      error: z.string().optional(),
      leaseUntil: z.number().optional(),
    }),
  ),
  attempts: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  note: z.string().optional(),
};

/** フィードバックの投稿テンプレート（domain の feedbackTemplateIds） */
export const vFeedbackTemplateId = z.enum(["creator_first", "creator_update", "reviewer"]);

/** リアクション（絵文字ごとに押した人。domain の ReactionEntry） */
export const vReactionEntries = z.array(
  object({ emoji: z.string(), userIds: z.array(z.string()) }),
);
