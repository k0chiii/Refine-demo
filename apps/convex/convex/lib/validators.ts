import { v } from "convex/values";

export const vPermissionLevel = v.union(v.literal("view"), v.literal("review"), v.literal("edit"), v.literal("manage"));
export const vPrincipalType = v.union(v.literal("user"), v.literal("group"));
export const vMediaType = v.union(v.literal("pdf"), v.literal("image"), v.literal("document"), v.literal("video"), v.literal("web"), v.literal("figma"), v.literal("other"));
export const vConfidentiality = v.union(v.literal("normal"), v.literal("restricted"));
export const vRevisionKind = v.union(v.literal("rough"), v.literal("standard"));
export const vArtifactRole = v.union(v.literal("source"), v.literal("preview"), v.literal("external"));
export const vArtifactType = v.union(v.literal("pdf"), v.literal("image"), v.literal("document"), v.literal("other"), v.literal("external_link"));
export const vThreadKind = v.union(v.literal("correction"), v.literal("question"), v.literal("discussion"), v.literal("decision"));
export const vSeverity = v.union(v.literal("critical"), v.literal("major"), v.literal("minor"), v.literal("info"));
export const vDecision = v.union(v.literal("acknowledged"), v.literal("accepted"), v.literal("rejected"), v.literal("deferred"), v.literal("resolved"));
export const vLifecycleTarget = v.union(v.literal("draft"), v.literal("active"), v.literal("on_hold"), v.literal("cancelled"));
