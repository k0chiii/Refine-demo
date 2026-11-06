import { describe, expect, it } from "vite-plus/test";
import {
  assertItemsReadyForConfirm,
  assertItemUploadable,
  assertSubmissionBaseCurrent,
  markItemFailed,
  markItemVerified,
  type UploadItem,
  type UploadSession,
} from "../revision/UploadSession.ts";
import type { Revision } from "../revision/Revision.ts";
import {
  adoptAttempt,
  assertAttemptAdoptable,
  discardAttempt,
  isAttemptOrphan,
  markAttemptPurged,
  releaseAdoptedAttempt,
  UPLOAD_ATTEMPT_TTL_MS,
  uploadAttemptObjectKey,
  type UploadAttempt,
} from "../storage/UploadAttempt.ts";

const T0 = Date.UTC(2026, 10, 1);
const code = (c: string) => expect.objectContaining({ code: c });

const attempt = (over: Partial<UploadAttempt> = {}): UploadAttempt => ({
  id: "a1",
  target: "uploadItem",
  targetId: "i1",
  uploaderId: "u1",
  objectKey: uploadAttemptObjectKey("works/w/sessions/s/0-a.pdf", "a1"),
  state: "reserved",
  createdAt: T0,
  ...over,
});

const item = (over: Partial<UploadItem> = {}): UploadItem => ({
  id: "i1",
  sessionId: "s1",
  fileName: "a.pdf",
  mimeType: "application/pdf",
  type: "pdf",
  role: "source",
  keyPrefix: "works/w/sessions/s/0-a.pdf",
  status: "pending",
  ...over,
});

describe("転送の試行（試行ごとのキー・採用は 1 つだけ）", () => {
  it("試行のキーは項目の名前空間の下で試行ごとに分かれる", () => {
    expect(uploadAttemptObjectKey("p", "a1")).toBe("p/attempts/a1");
    expect(uploadAttemptObjectKey("p", "a1")).not.toBe(uploadAttemptObjectKey("p", "a2"));
  });
  it("予約中で期限内の試行だけを採用できる", () => {
    expect(() => assertAttemptAdoptable(attempt(), T0)).not.toThrow();
    for (const bad of [attempt({ state: "adopted" }), attempt({ state: "discarded" })])
      expect(() => assertAttemptAdoptable(bad, T0)).toThrow(code("upload_attempt_closed"));
    expect(() => assertAttemptAdoptable(attempt(), T0 + UPLOAD_ATTEMPT_TTL_MS)).toThrow(
      code("upload_attempt_closed"),
    );
  });
  it("採用済みの試行は、他の試行の失敗（discard）では手放さない。清掃の対象にもならない", () => {
    const adopted = adoptAttempt(attempt(), T0);
    expect(discardAttempt(adopted, T0)).toBe(adopted);
    expect(isAttemptOrphan(adopted, T0 + 10 * UPLOAD_ATTEMPT_TTL_MS)).toBe(false);
    // 項目のやり直しで明示的に手放したときだけ清掃の対象
    expect(isAttemptOrphan(releaseAdoptedAttempt(adopted, T0), T0)).toBe(true);
  });
  it("清掃の対象: 破棄済み、または期限を過ぎた予約。消した後は対象外", () => {
    expect(isAttemptOrphan(attempt(), T0)).toBe(false);
    expect(isAttemptOrphan(attempt(), T0 + UPLOAD_ATTEMPT_TTL_MS)).toBe(true);
    const discarded = discardAttempt(attempt(), T0);
    expect(isAttemptOrphan(discarded, T0)).toBe(true);
    expect(isAttemptOrphan(markAttemptPurged(discarded, T0), T0)).toBe(false);
  });
});

describe("提出項目の採用と確定の条件", () => {
  it("検証済みの項目は、別の試行の失敗で failed に戻らない", () => {
    const verified = markItemVerified(item(), { size: 1, sha256: "x", objectKey: "k/attempts/a" });
    expect(verified).toMatchObject({ status: "verified", objectKey: "k/attempts/a" });
    expect(markItemFailed(verified, "遅れた失敗")).toBe(verified);
    expect(() => assertItemUploadable(verified)).toThrow(code("upload_item_invalid_state"));
    const external = item({ role: "external" });
    delete external.keyPrefix;
    expect(() => assertItemUploadable(external)).toThrow(code("upload_item_invalid_state"));
  });
  it("採用した実体の無い項目では確定できない", () => {
    expect(() => assertItemsReadyForConfirm([item({ status: "verified" })])).toThrow(
      code("revision_artifacts_not_verified"),
    );
  });
  it("準備した後に版が増えていれば確定しない（比較はサーバーが記録した基準で必ず行う）", () => {
    const session = { id: "s1", baseRevisionCount: 1 } as UploadSession;
    const rev = { id: "r" } as Revision;
    expect(() => assertSubmissionBaseCurrent(session, [rev])).not.toThrow();
    expect(() => assertSubmissionBaseCurrent(session, [rev, rev])).toThrow(
      code("revision_submission_conflict"),
    );
    // 基準の無い古いセッションは確定させない
    const legacy = { id: "s0" } as UploadSession;
    expect(() => assertSubmissionBaseCurrent(legacy, [])).toThrow(
      code("revision_submission_conflict"),
    );
  });
});
