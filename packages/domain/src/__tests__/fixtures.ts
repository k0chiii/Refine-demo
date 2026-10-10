import type { CommentThread } from "../comment/CommentThread.ts";
import type { Revision } from "../revision/Revision.ts";
import type { Work } from "../work/Work.ts";

export const T0 = Date.UTC(2026, 10, 1, 0, 0, 0); // 2026-11-01T00:00Z
export const HOUR = 3_600_000;

export function makeWork(over: Partial<Work> = {}): Work {
  return {
    id: "work1",
    year: 100,
    title: "パンフレット",
    purpose: "来場者案内",
    category: "印刷物",
    mediaType: "pdf",
    productionTeamIds: [],
    relatedTeamIds: [],
    managerIds: ["manager"],
    creatorIds: ["creator"],
    approverId: "approver",
    lifecycle: "active",
    confidentiality: "normal",
    version: 1,
    ...over,
  };
}

export function makeRevision(over: Partial<Revision> = {}): Revision {
  return {
    id: "rev1",
    workId: "work1",
    kind: "standard",
    sequence: 1,
    reviewType: "general",
    submittedBy: "creator",
    submittedAt: T0,
    deadlineAt: T0 + 24 * HOUR,
    reviewState: "open",
    changeSummary: "",
    focusNotes: "",
    ...over,
  };
}

export function makeThread(over: Partial<CommentThread> = {}): CommentThread {
  return {
    id: "t1",
    revisionId: "rev1",
    authorId: "reviewer",
    body: "誤字",
    kind: "correction",
    severity: "major",
    resolution: "open",
    createdAt: T0 + HOUR,
    ...over,
  };
}
