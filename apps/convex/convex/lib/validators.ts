import { v } from "convex/values";

/**
 * アバター（Humation）の設定（me.setAvatar の引数）。形の検証と正規化は domain の validateAvatarConfig（部品の名前が実在するかは Web 側）。
 * selections: 部位 → 部品の名前、colors: 色の役割 → 6 桁の 16 進、background: 背景の色。
 * 部位・色の役割は domain `AVATAR_PART_SLOTS` / `AVATAR_COLOR_SLOTS` と同じ（丸いアイコンに映るものだけ。
 * ボトムスは映らないので外した。利用者指示 2026-10-17）。
 */
export const vAvatarConfig = v.object({
  seed: v.optional(v.string()),
  selections: v.optional(
    v.object({
      head: v.optional(v.string()),
      body: v.optional(v.string()),
      item: v.optional(v.string()),
      glasses: v.optional(v.string()),
    }),
  ),
  colors: v.optional(
    v.object({
      hair: v.optional(v.string()),
      skin: v.optional(v.string()),
      clothes: v.optional(v.string()),
      stroke: v.optional(v.string()),
    }),
  ),
  background: v.optional(v.string()),
});
/**
 * 保存済みのアバターの設定（users.avatar）。外した部位・色の役割（`bottom`）が残っている古い値も読めるよう、
 * 部位・役割の名前は限定しない。読むときは domain `parseAvatarConfig` が知らない項目を捨てる。
 */
export const vStoredAvatarConfig = v.object({
  seed: v.optional(v.string()),
  selections: v.optional(v.record(v.string(), v.string())),
  colors: v.optional(v.record(v.string(), v.string())),
  background: v.optional(v.string()),
});

export const vPermissionLevel = v.union(
  v.literal("review"),
  v.literal("edit"),
  v.literal("manage"),
);
export const vPrincipalType = v.union(v.literal("user"), v.literal("group"));
export const vMediaType = v.union(
  v.literal("pdf"),
  v.literal("image"),
  v.literal("document"),
  v.literal("sns"),
  v.literal("video"),
  v.literal("web"),
  v.literal("figma"),
  v.literal("other"),
);
export const vConfidentiality = v.union(v.literal("normal"), v.literal("restricted"));

// ---------------------------------------------------------------- Notion の制作物 DB・版 DB・担当 DB に揃えた項目（docs/NOTION_ALIGNMENT.md）
/** 大ジャンル（domain の workGenres） */
export const vWorkGenre = v.union(
  v.literal("graphic"),
  v.literal("ui"),
  v.literal("video"),
  v.literal("text_ja"),
  v.literal("text_foreign"),
);
/** 小ジャンル（domain の workSubGenres のコード） */
export const vWorkSubGenre = v.union(
  v.literal("digital_sns"),
  v.literal("digital_web"),
  v.literal("digital_youtube"),
  v.literal("digital_other"),
  v.literal("print_flyer"),
  v.literal("print_other"),
  v.literal("print_banner"),
  v.literal("print_booklet"),
  v.literal("slide"),
  v.literal("solid_decoration"),
  v.literal("print_large"),
  v.literal("print_decoration"),
  v.literal("goods"),
  v.literal("resource_icon"),
  v.literal("graphic_other"),
  v.literal("video"),
  v.literal("pr_text"),
  v.literal("plan_text"),
  v.literal("web_copy"),
  v.literal("form"),
  v.literal("text_other"),
  v.literal("web_design"),
  v.literal("committee_screen"),
);
/** 制作物の Notion に揃えた任意の項目（表の形。登録・保存の形） */
export const vWorkMetadataFields = {
  genre: v.optional(vWorkGenre),
  subGenre: v.optional(vWorkSubGenre),
  stakeholderIds: v.optional(v.array(v.string())),
  publishAt: v.optional(v.number()),
  requiresPrinterSubmission: v.optional(v.boolean()),
  printQuantity: v.optional(v.number()),
  sizeOrLength: v.optional(v.string()),
  productionDays: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
};
/** 同じ項目の変更の形（null で消す） */
export const vWorkMetadataPatch = {
  genre: v.optional(v.union(vWorkGenre, v.null())),
  subGenre: v.optional(v.union(vWorkSubGenre, v.null())),
  stakeholderIds: v.optional(v.union(v.array(v.string()), v.null())),
  publishAt: v.optional(v.union(v.number(), v.null())),
  requiresPrinterSubmission: v.optional(v.union(v.boolean(), v.null())),
  printQuantity: v.optional(v.union(v.number(), v.null())),
  sizeOrLength: v.optional(v.union(v.string(), v.null())),
  productionDays: v.optional(v.union(v.number(), v.null())),
  tags: v.optional(v.union(v.array(v.string()), v.null())),
};
/** 版の提出時の申告（写真・めい・指針外の色の使用） */
export const vRevisionDeclarations = v.object({
  usesPhotos: v.boolean(),
  usesMascot: v.boolean(),
  usesOffPaletteColors: v.boolean(),
});
/** 局のコード（domain の bureauCodes） */
export const vBureauCode = v.union(
  v.literal("JIM"),
  v.literal("ZAI"),
  v.literal("SSK"),
  v.literal("EVE"),
  v.literal("PR"),
  v.literal("SYS"),
  v.literal("WG"),
  v.literal("CAP"),
);
export const vRevisionKind = v.union(v.literal("rough"), v.literal("standard"));
export const vArtifactRole = v.union(
  v.literal("source"),
  v.literal("preview"),
  v.literal("external"),
);
export const vArtifactType = v.union(
  v.literal("pdf"),
  v.literal("image"),
  v.literal("document"),
  v.literal("video"),
  v.literal("other"),
  v.literal("external_link"),
);
/** 添付の由来（Figma から取り込んだ・サイトのスクリーンショット）。domain の ArtifactOrigin と同じ形 */
export const vArtifactOrigin = v.union(
  v.object({
    kind: v.literal("figma"),
    fileKey: v.string(),
    nodeId: v.string(),
    nodeName: v.optional(v.string()),
    figmaVersion: v.optional(v.string()),
    lastModified: v.optional(v.string()),
    scale: v.number(),
    box: v.object({ width: v.number(), height: v.number() }),
  }),
  v.object({
    kind: v.literal("web_snapshot"),
    url: v.string(),
    deviceId: v.optional(v.string()),
    viewport: v.object({
      width: v.number(),
      height: v.number(),
      dpr: v.number(),
      orientation: v.union(v.literal("portrait"), v.literal("landscape")),
    }),
    userAgent: v.optional(v.string()),
    fullPage: v.boolean(),
    capturedAt: v.number(),
  }),
);
/** Figma から取り込んだときに Figma の応答から埋める値（検証完了に添える） */
export const vFigmaImportMeta = v.object({
  nodeName: v.string(),
  figmaVersion: v.optional(v.string()),
  lastModified: v.optional(v.string()),
  box: v.object({ width: v.number(), height: v.number() }),
});
export const vThreadKind = v.union(
  v.literal("correction"),
  v.literal("question"),
  v.literal("discussion"),
  v.literal("decision"),
);
export const vSeverity = v.union(
  v.literal("critical"),
  v.literal("major"),
  v.literal("minor"),
  v.literal("info"),
);
export const vDecision = v.union(
  v.literal("acknowledged"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("deferred"),
  v.literal("resolved"),
);
export const vLifecycleTarget = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("on_hold"),
  v.literal("cancelled"),
);
export const vCheckType = v.union(
  v.literal("photo"),
  v.literal("name"),
  v.literal("language"),
  v.literal("rules"),
  v.literal("design"),
  v.literal("other"),
);

// ---------------------------------------------------------------- 表記統一
export const vRuleException = v.object({
  kind: v.union(
    v.literal("phrase"),
    v.literal("before"),
    v.literal("after"),
    v.literal("category"),
  ),
  value: v.string(),
  note: v.optional(v.string()),
});
export const vRuleDraftFields = {
  ruleId: v.string(),
  categoryCode: v.string(),
  title: v.string(),
  description: v.string(),
  correct: v.array(v.string()),
  incorrect: v.array(v.string()),
  patterns: v.array(v.string()),
  exceptions: v.array(vRuleException),
  language: v.union(v.literal("ja"), v.literal("en"), v.literal("zh")),
  scopes: v.array(v.string()),
  years: v.array(v.number()),
  priority: v.number(),
  strictness: v.union(v.literal("required"), v.literal("recommended"), v.literal("review")),
  enabled: v.boolean(),
  note: v.optional(v.string()),
  translations: v.optional(v.object({ en: v.optional(v.string()), zh: v.optional(v.string()) })),
};
export const vRuleDraft = v.object(vRuleDraftFields);
export const vRuleFields = {
  ...vRuleDraftFields,
  revision: v.number(),
  createdBy: v.string(),
  updatedBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  publishedAt: v.optional(v.number()),
};
export const vRuleCategoryFields = {
  code: v.string(),
  name: v.string(),
  description: v.string(),
  parents: v.array(v.string()),
  policyNotes: v.string(),
  order: v.number(),
};
export const vRuleSetSnapshot = v.object({
  categories: v.array(v.string()),
  year: v.number(),
  // depth: 提出時の継承の深さ（古い版の記録には無い）
  rules: v.array(
    v.object({ ruleId: v.string(), revision: v.number(), depth: v.optional(v.number()) }),
  ),
  hash: v.string(),
});
export const vProposalKind = v.union(v.literal("new"), v.literal("change"), v.literal("report"));
export const vProposalStatus = v.union(
  v.literal("open"),
  v.literal("approved"),
  v.literal("rejected"),
);
export const vProposalContext = v.object({
  workId: v.optional(v.string()),
  revisionId: v.optional(v.string()),
  artifactId: v.optional(v.string()),
  quote: v.optional(v.string()),
  surrounding: v.optional(v.string()),
});

// ---------------------------------------------------------------- 自動校正
export const vTextSource = v.union(v.literal("document"), v.literal("pdf_text"), v.literal("ocr"));
export const vBotOrigin = v.object({
  kind: v.literal("bot"),
  detector: v.union(v.literal("rule"), v.literal("morphology"), v.literal("ocr"), v.literal("ai")),
  ruleId: v.string(),
  ruleRevision: v.number(),
  runId: v.string(),
  fingerprint: v.string(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  needsReview: v.boolean(),
  original: v.string(),
  suggestion: v.string(),
  textSource: vTextSource,
});
const vRect = v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() });
const vTextBox = v.object({ start: v.number(), end: v.number(), rect: vRect });
export const vProofreadSegment = v.union(
  v.object({ kind: v.literal("text"), text: v.string() }),
  v.object({
    kind: v.literal("page"),
    page: v.number(),
    text: v.string(),
    boxes: v.array(vTextBox),
    ocrConfidence: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("image"),
    text: v.string(),
    boxes: v.array(vTextBox),
    confidence: v.number(),
  }),
);
const vRunStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("skipped"),
);
export const vProofreadingRunFields = {
  workId: v.string(),
  revisionId: v.string(),
  status: vRunStatus,
  snapshotHash: v.string(),
  artifacts: v.array(
    v.object({
      artifactId: v.string(),
      status: vRunStatus,
      findings: v.number(),
      source: v.optional(vTextSource),
      error: v.optional(v.string()),
      leaseUntil: v.optional(v.number()),
    }),
  ),
  attempts: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  note: v.optional(v.string()),
};

/** フィードバックの投稿テンプレート（domain の feedbackTemplateIds） */
export const vFeedbackTemplateId = v.union(
  v.literal("creator_first"),
  v.literal("creator_update"),
  v.literal("reviewer"),
);

/** リアクション（絵文字ごとに押した人。domain の ReactionEntry。FB の投稿・コメント・返信で共通） */
export const vReactionEntries = v.array(
  v.object({ emoji: v.string(), userIds: v.array(v.string()) }),
);
