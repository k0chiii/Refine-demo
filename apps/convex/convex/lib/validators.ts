import { v } from "convex/values";

export const vPermissionLevel = v.union(
  v.literal("view"),
  v.literal("review"),
  v.literal("edit"),
  v.literal("manage"),
);
export const vPrincipalType = v.union(v.literal("user"), v.literal("group"));
export const vMediaType = v.union(
  v.literal("pdf"),
  v.literal("image"),
  v.literal("document"),
  v.literal("video"),
  v.literal("web"),
  v.literal("figma"),
  v.literal("other"),
);
export const vConfidentiality = v.union(v.literal("normal"), v.literal("restricted"));
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
  v.literal("other"),
  v.literal("external_link"),
);
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
  rules: v.array(v.object({ ruleId: v.string(), revision: v.number() })),
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
