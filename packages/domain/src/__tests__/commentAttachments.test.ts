import { describe, expect, it } from "vite-plus/test";
import {
  COMMENT_FILES_MAX,
  COMMENT_FILE_MAX_BYTES,
  COMMENT_FILE_TTL_MS,
  COMMENT_THUMB_MAX_BYTES,
  assertCommentFileAttachable,
  assertCommentFileUploadable,
  assertCommentThumbUploadable,
  attachCommentFile,
  canReadCommentFile,
  commentFileKeyPrefix,
  commentFileObjectKeys,
  commentFileType,
  commentThumbObjectKey,
  failCommentFile,
  isCommentFileServable,
  isCommentFileStale,
  recordCommentThumb,
  removeCommentFile,
  toCommentFileView,
  validateCommentFileDeclaration,
  validateCommentFileIds,
  validateCommentThumb,
  verifyCommentFile,
  type CommentFile,
} from "../comment/attachments.ts";
import { MAX_UPLOAD_BYTES } from "../revision/UploadSession.ts";
import { T0 } from "./fixtures.ts";

const code = (c: string) => expect.objectContaining({ code: c });

function makeFile(over: Partial<CommentFile> = {}): CommentFile {
  return {
    id: "f1",
    workId: "work1",
    revisionId: "rev1",
    uploaderId: "reviewer",
    fileName: "photo.webp",
    originalName: "photo.png",
    mimeType: "image/webp",
    type: "image",
    declaredSize: 100,
    size: 100,
    sha256: "abc",
    keyPrefix: "comments/work1/f1/photo.webp",
    objectKey: "comments/work1/f1/photo.webp/attempts/a1",
    status: "verified",
    createdAt: T0,
    ...over,
  };
}

describe("コメントの添付: 検査", () => {
  it("上限は 10 件・1 ファイル MAX_UPLOAD_BYTES・サムネイル 512 KB", () => {
    expect(COMMENT_FILES_MAX).toBe(10);
    expect(COMMENT_FILE_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
    expect(COMMENT_THUMB_MAX_BYTES).toBe(512 * 1024);
  });
  it("添付は重複を除いて 10 件まで", () => {
    expect(validateCommentFileIds(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(validateCommentFileIds(undefined)).toEqual([]);
    const eleven = Array.from({ length: 11 }, (_, i) => `f${i}`);
    expect(() => validateCommentFileIds(eleven)).toThrow(code("comment_file_invalid"));
    expect(validateCommentFileIds(eleven.slice(0, 10))).toHaveLength(10);
  });
  it("種類は画像 / PDF / 文書 / その他（SVG は画像にしない）", () => {
    expect(commentFileType("image/webp", "a.webp")).toBe("image");
    expect(commentFileType("image/avif", "a.avif")).toBe("image");
    expect(commentFileType("application/pdf", "a.pdf")).toBe("pdf");
    expect(commentFileType("text/plain", "a.txt")).toBe("document");
    expect(commentFileType("image/svg+xml", "a.svg")).toBe("other");
    expect(commentFileType("application/zip", "a.zip")).toBe("other");
  });
  it("申告の検査: 名前・大きさ・寸法", () => {
    expect(
      validateCommentFileDeclaration({
        fileName: " 写真.webp ",
        originalName: "IMG_1.png",
        mimeType: "image/webp",
        size: 1000,
        originalSize: 5000,
        width: 2560,
        height: 1440,
      }),
    ).toMatchObject({
      fileName: "写真.webp",
      originalName: "IMG_1.png",
      type: "image",
      width: 2560,
      height: 1440,
      originalSize: 5000,
    });
    // 元の名前を省けば保存する名前と同じ
    expect(
      validateCommentFileDeclaration({ fileName: "a.pdf", mimeType: "application/pdf", size: 1 })
        .originalName,
    ).toBe("a.pdf");
    expect(() =>
      validateCommentFileDeclaration({ fileName: " ", mimeType: "image/png", size: 1 }),
    ).toThrow(code("comment_file_invalid"));
    expect(() =>
      validateCommentFileDeclaration({ fileName: "a.png", mimeType: "image/png", size: -1 }),
    ).toThrow(code("comment_file_invalid"));
    expect(() =>
      validateCommentFileDeclaration({
        fileName: "a.png",
        mimeType: "image/png",
        size: COMMENT_FILE_MAX_BYTES + 1,
      }),
    ).toThrow(code("upload_file_too_large"));
    expect(() =>
      validateCommentFileDeclaration({
        fileName: "a.png",
        mimeType: "image/png",
        size: 1,
        width: 0,
        height: 10,
      }),
    ).toThrow(code("comment_file_invalid"));
  });
  it("寸法は画像だけ、両方そろったときだけ持つ", () => {
    const pdf = validateCommentFileDeclaration({
      fileName: "a.pdf",
      mimeType: "application/pdf",
      size: 1,
      width: 10,
      height: 10,
    });
    expect(pdf.width).toBeUndefined();
    const half = validateCommentFileDeclaration({
      fileName: "a.png",
      mimeType: "image/png",
      size: 1,
      width: 10,
    });
    expect(half.width).toBeUndefined();
  });
  it("キーは comments/{制作物}/{添付}/{名前}、サムネイルはその下の固定キー", () => {
    expect(commentFileKeyPrefix("w1", "f1", "案 1.webp")).toBe("comments/w1/f1/案_1.webp");
    expect(commentThumbObjectKey("comments/w1/f1/a.webp")).toBe("comments/w1/f1/a.webp/thumb");
  });
});

describe("コメントの添付: 検証と状態", () => {
  it("申告サイズと違えば failed、合えば verified で試行のキーを採用する", () => {
    const pending = makeFile({ status: "pending", declaredSize: 10, objectKey: "" });
    const key = "comments/work1/f1/photo.webp/attempts/a1";
    expect(verifyCommentFile(pending, { size: 9, sha256: "x", objectKey: key })).toMatchObject({
      status: "failed",
      objectKey: "",
    });
    expect(verifyCommentFile(pending, { size: 10, sha256: "x", objectKey: key })).toMatchObject({
      status: "verified",
      size: 10,
      sha256: "x",
      objectKey: key,
    });
  });
  it("検証済みの添付は遅れた失敗で failed に戻らない", () => {
    const v = makeFile();
    expect(failCommentFile(v, "遅れた失敗")).toBe(v);
    expect(failCommentFile(makeFile({ status: "pending" }), "破損")).toMatchObject({
      status: "failed",
    });
  });
  it("アップロードを受けるのは本人の、付ける前の、未検証の添付だけ", () => {
    const pending = makeFile({ status: "pending", objectKey: "" });
    expect(() => assertCommentFileUploadable(pending, "reviewer")).not.toThrow();
    expect(() => assertCommentFileUploadable(pending, "other")).toThrow(
      code("comment_file_not_found"),
    );
    for (const bad of [
      { threadId: "t1" },
      { abandonedAt: T0 },
      { removedAt: T0 },
      { status: "verified" as const },
    ])
      expect(() => assertCommentFileUploadable({ ...pending, ...bad }, "reviewer")).toThrow(
        code("comment_file_invalid"),
      );
    // 名前空間を予約していない添付は受けない
    const { keyPrefix: _unused, ...unreserved } = pending;
    void _unused;
    expect(() => assertCommentFileUploadable(unreserved, "reviewer")).toThrow(
      code("comment_file_invalid"),
    );
  });
  it("サムネイルを受けるのは本人の、付ける前の、画像の添付だけ（検証前でも可・失敗は不可）", () => {
    const f = makeFile({ status: "pending", objectKey: "" });
    expect(() => assertCommentThumbUploadable(f, "reviewer")).not.toThrow();
    expect(() => assertCommentThumbUploadable(makeFile(), "reviewer")).not.toThrow();
    expect(() => assertCommentThumbUploadable(f, "other")).toThrow(code("comment_file_not_found"));
    expect(() => assertCommentThumbUploadable({ ...f, status: "failed" }, "reviewer")).toThrow(
      code("comment_file_invalid"),
    );
    expect(() => assertCommentThumbUploadable({ ...f, threadId: "t1" }, "reviewer")).toThrow(
      code("comment_file_invalid"),
    );
    expect(() =>
      assertCommentThumbUploadable({ ...f, type: "pdf", mimeType: "application/pdf" }, "reviewer"),
    ).toThrow(code("comment_file_invalid"));
  });
  it("サムネイルは webp / jpeg の 512 KB 以内", () => {
    expect(validateCommentThumb({ mimeType: "image/webp", size: 1000 })).toBe("image/webp");
    expect(validateCommentThumb({ mimeType: "image/jpeg; charset=x", size: 1000 })).toBe(
      "image/jpeg",
    );
    expect(() => validateCommentThumb({ mimeType: "image/png", size: 10 })).toThrow(
      code("comment_file_invalid"),
    );
    expect(() => validateCommentThumb({ mimeType: "image/webp", size: 0 })).toThrow(
      code("comment_file_invalid"),
    );
    expect(() =>
      validateCommentThumb({ mimeType: "image/webp", size: COMMENT_THUMB_MAX_BYTES + 1 }),
    ).toThrow(code("comment_file_invalid"));
    expect(validateCommentThumb({ mimeType: "image/webp", size: COMMENT_THUMB_MAX_BYTES })).toBe(
      "image/webp",
    );
  });
  it("サムネイルの保存を記録すると hasThumb になり、清掃の対象のキーに加わる", () => {
    const f = makeFile();
    expect(toCommentFileView(f)!.hasThumb).toBe(false);
    const withThumb = recordCommentThumb(f, { size: 300, mimeType: "image/webp" });
    expect(withThumb).toMatchObject({
      thumbObjectKey: "comments/work1/f1/photo.webp/thumb",
      thumbSize: 300,
      thumbMime: "image/webp",
    });
    expect(toCommentFileView(withThumb)!.hasThumb).toBe(true);
    expect(commentFileObjectKeys(withThumb)).toEqual([
      "comments/work1/f1/photo.webp/attempts/a1",
      "comments/work1/f1/photo.webp/thumb",
    ]);
    // 画像は、サムネイルの記録が間に合わなかった場合に備えて固定キーを常に含める。画像でなければ原本だけ
    expect(commentFileObjectKeys(makeFile())).toEqual([
      "comments/work1/f1/photo.webp/attempts/a1",
      "comments/work1/f1/photo.webp/thumb",
    ]);
    expect(commentFileObjectKeys(makeFile({ type: "pdf", objectKey: "" }))).toEqual([]);
  });
  it("付けられるのは本人が同じ制作物に上げた検証済みの、まだ付けていない添付だけ", () => {
    const by = { uploaderId: "reviewer", workId: "work1" };
    expect(assertCommentFileAttachable(makeFile(), "f1", by).id).toBe("f1");
    for (const bad of [
      null,
      makeFile({ uploaderId: "other" }),
      makeFile({ workId: "work2" }),
      makeFile({ status: "pending" }),
      makeFile({ threadId: "t0" }),
      makeFile({ abandonedAt: T0 }),
      makeFile({ removedAt: T0 }),
      makeFile({ purgedAt: T0 }),
    ])
      expect(() => assertCommentFileAttachable(bad, "f1", by)).toThrow(
        code("comment_file_not_ready"),
      );
  });
  it("付けると threadId（返信なら eventId も）と版が入る", () => {
    const a = attachCommentFile(makeFile(), { threadId: "t1", revisionId: "rev2" });
    expect(a).toMatchObject({ threadId: "t1", revisionId: "rev2" });
    expect(a.eventId).toBeUndefined();
    expect(
      attachCommentFile(makeFile(), { threadId: "t1", eventId: "e1", revisionId: "rev1" }).eventId,
    ).toBe("e1");
  });
  it("付けないまま 24 時間たった添付は放置扱い", () => {
    const f = makeFile();
    expect(isCommentFileStale(f, T0 + COMMENT_FILE_TTL_MS - 1)).toBe(false);
    expect(isCommentFileStale(f, T0 + COMMENT_FILE_TTL_MS)).toBe(true);
    expect(isCommentFileStale({ ...f, threadId: "t1" }, T0 + COMMENT_FILE_TTL_MS)).toBe(false);
    expect(isCommentFileStale({ ...f, abandonedAt: T0 }, T0 + COMMENT_FILE_TTL_MS)).toBe(false);
  });
  it("削除で手放した添付は冪等に removedAt が付く", () => {
    const f = removeCommentFile(makeFile({ threadId: "t1" }), T0 + 5);
    expect(f.removedAt).toBe(T0 + 5);
    expect(removeCommentFile(f, T0 + 99).removedAt).toBe(T0 + 5);
  });
});

describe("コメントの添付: 読み取り", () => {
  const live = { threadDeleted: false, replyDeleted: false };
  const viewer = (userId: string, canView = true) => ({ userId, canView });

  it("付いた添付は、制作物を見られる人なら誰でも読める", () => {
    const f = makeFile({ threadId: "t1" });
    expect(canReadCommentFile(f, viewer("someone"), live)).toBe(true);
    expect(canReadCommentFile(f, viewer("someone", false), live)).toBe(false);
  });
  it("コメントが削除されたら誰も読めない（返信の添付は返信の削除でも）", () => {
    const f = makeFile({ threadId: "t1" });
    expect(canReadCommentFile(f, viewer("reviewer"), { ...live, threadDeleted: true })).toBe(false);
    const r = makeFile({ threadId: "t1", eventId: "e1" });
    expect(canReadCommentFile(r, viewer("someone"), { ...live, replyDeleted: true })).toBe(false);
    // コメント本体の添付は、返信が削除されても読める
    expect(canReadCommentFile(f, viewer("someone"), { ...live, replyDeleted: true })).toBe(true);
    expect(canReadCommentFile(f, viewer("someone"), null)).toBe(false);
    expect(canReadCommentFile(removeCommentFile(f, T0), viewer("reviewer"), live)).toBe(false);
  });
  it("付ける前の添付は、上げた本人だけ（放置されたら本人でも読めない）", () => {
    const f = makeFile();
    expect(canReadCommentFile(f, viewer("reviewer"), null)).toBe(true);
    expect(canReadCommentFile(f, viewer("other"), null)).toBe(false);
    expect(canReadCommentFile({ ...f, abandonedAt: T0 }, viewer("reviewer"), null)).toBe(false);
  });
  it("R2 から消した実体は読めない", () => {
    expect(canReadCommentFile(makeFile({ purgedAt: T0, threadId: "t" }), viewer("x"), live)).toBe(
      false,
    );
    expect(isCommentFileServable(makeFile({ purgedAt: T0 }), "original")).toBe(false);
    expect(isCommentFileServable(makeFile({ status: "pending" }), "original")).toBe(false);
    expect(isCommentFileServable(makeFile(), "thumb")).toBe(false);
    expect(isCommentFileServable(makeFile({ thumbObjectKey: "k" }), "thumb")).toBe(true);
  });
  it("画面への要約は検証済み・手放していないものだけ", () => {
    expect(toCommentFileView(makeFile({ width: 100, height: 50 }))).toEqual({
      id: "f1",
      name: "photo.webp",
      mime: "image/webp",
      size: 100,
      type: "image",
      width: 100,
      height: 50,
      hasThumb: false,
    });
    expect(toCommentFileView(makeFile({ status: "pending" }))).toBeNull();
    expect(toCommentFileView(makeFile({ removedAt: T0 }))).toBeNull();
    expect(toCommentFileView(makeFile({ purgedAt: T0 }))).toBeNull();
  });
});
