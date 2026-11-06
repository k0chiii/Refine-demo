import { v } from "convex/values";
export const processingKind = v.union(
  v.literal("figma"),
  v.literal("image"),
  v.literal("video-frame"),
  v.literal("stream"),
  v.literal("web-snapshot"),
  v.literal("container-preview"),
);
export const processingOptions = v.object({
  artifactId: v.optional(v.id("artifacts")),
  itemId: v.optional(v.id("uploadItems")),
  workId: v.optional(v.id("works")),
  url: v.optional(v.string()),
  time: v.optional(v.number()),
});
export const processingOutput = v.object({
  key: v.optional(v.string()),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  time: v.optional(v.number()),
  streamUid: v.optional(v.string()),
});
