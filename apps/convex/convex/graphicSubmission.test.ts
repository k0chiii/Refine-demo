import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness, HOUR, type Harness } from "../test/harness";
import { setupWork } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

type Cast = Awaited<ReturnType<typeof createCast>>;

/** 準備 → サービス境界（共有秘密つきの HTTP）で begin/complete → 確定の手前まで */
async function prepareAndUpload(
  cast: Cast,
  workId: Id<"works">,
  files: Array<{ fileName: string; mimeType: string; type: "pdf" | "image" | "other" }>,
  pdfCompatible: (fileName: string) => unknown,
) {
  const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
    workId,
    kind: "standard",
    reviewType: "general",
    deadlineAt: Date.now() + 24 * HOUR,
    changeSummary: "",
    focusNotes: "",
    items: files.map((f) => ({ ...f, role: "source" as const, declaredSize: 10 })),
  });
  const secret = "test-upload-secret-0123456789";
  const post = (path: string, body: unknown) =>
    cast.creator.as.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MF100-Service-Key": secret },
      body: JSON.stringify(body),
    });
  for (const [k, item] of prepared.items.entries()) {
    const target = (await (
      await post("/internal/uploads/items/begin", { itemId: item.id })
    ).json()) as {
      attemptId: string;
    };
    const flag = pdfCompatible(item.fileName);
    const res = await post("/internal/uploads/items/complete", {
      attemptId: target.attemptId,
      size: 10,
      sha256: String(k)
        .repeat(64)
        .slice(0, 64)
        .replace(/[^0-9a-f]/g, "a"),
      ...(flag !== undefined ? { pdfCompatible: flag } : {}),
    });
    expect(await res.json()).toEqual({ status: "verified", failureMessage: null });
  }
  return prepared;
}

describe("Convex 統合: グラフィック制作物の PDF・画像・Illustrator・InDesign の提出", () => {
  const withSecret = async (run: (t: Harness) => Promise<void>) => {
    const prev = process.env.MF100_UPLOAD_SECRET;
    process.env.MF100_UPLOAD_SECRET = "test-upload-secret-0123456789";
    try {
      await run(createHarness());
    } finally {
      if (prev === undefined) delete process.env.MF100_UPLOAD_SECRET;
      else process.env.MF100_UPLOAD_SECRET = prev;
    }
  };

  it("PDF・.ai・.indd を一緒に出せる。Worker が PDF 互換と伝えた .ai だけが PDF の種類になる", async () => {
    await withSecret(async (t) => {
      const cast = await createCast(t);
      const workId = await setupWork(t, cast, { mediaType: "pdf" });
      const prepared = await prepareAndUpload(
        cast,
        workId,
        [
          { fileName: "poster.pdf", mimeType: "application/pdf", type: "pdf" },
          { fileName: "poster.ai", mimeType: "application/postscript", type: "other" },
          { fileName: "poster.indd", mimeType: "", type: "other" },
          { fileName: "other.ai", mimeType: "", type: "other" },
        ],
        // poster.ai は PDF 互換、other.ai は互換ではない（.ai 以外には Worker は伝えない）
        (name) => (name === "poster.ai" ? true : name === "other.ai" ? false : undefined),
      );
      const confirmed = await cast.creator.as.mutation(api.submissions.confirm, {
        sessionId: prepared.sessionId as Id<"uploadSessions">,
      });
      const rev = await cast.creator.as.query(api.revisions.get, {
        revisionId: confirmed.revisionId,
      });
      const by = (name: string) => rev.artifacts.find((a) => a.fileName === name)!;
      expect(by("poster.pdf")).toMatchObject({ type: "pdf", mimeType: "application/pdf" });
      expect(by("poster.ai")).toMatchObject({ type: "pdf", mimeType: "application/illustrator" });
      expect(by("other.ai")).toMatchObject({ type: "other" });
      expect(by("poster.indd")).toMatchObject({
        type: "other",
        mimeType: "application/x-indesign",
      });
    });
  });

  it("pdfCompatible が真偽値でなければ無視する（PDF 互換とは扱わない）", async () => {
    await withSecret(async (t) => {
      const cast = await createCast(t);
      const workId = await setupWork(t, cast, { mediaType: "image" });
      const prepared = await prepareAndUpload(
        cast,
        workId,
        [
          { fileName: "a.ai", mimeType: "", type: "other" },
          { fileName: "b.png", mimeType: "image/png", type: "image" },
        ],
        (name) => (name === "a.ai" ? "yes" : undefined),
      );
      const confirmed = await cast.creator.as.mutation(api.submissions.confirm, {
        sessionId: prepared.sessionId as Id<"uploadSessions">,
      });
      const rev = await cast.creator.as.query(api.revisions.get, {
        revisionId: confirmed.revisionId,
      });
      expect(rev.artifacts.find((a) => a.fileName === "a.ai")?.type).toBe("other");
    });
  });

  it(".indd だけの提出は確定で断る。申告サイズが上限を超えるファイルは準備で断る", async () => {
    await withSecret(async (t) => {
      const cast = await createCast(t);
      const workId = await setupWork(t, cast, { mediaType: "pdf" });
      const prepared = await prepareAndUpload(
        cast,
        workId,
        [{ fileName: "poster.indd", mimeType: "", type: "other" }],
        () => undefined,
      );
      await expect(
        cast.creator.as.mutation(api.submissions.confirm, {
          sessionId: prepared.sessionId as Id<"uploadSessions">,
        }),
      ).rejects.toThrow(code("revision_no_reviewable_file"));

      await expect(
        cast.creator.as.mutation(api.submissions.prepare, {
          workId,
          kind: "standard",
          reviewType: "general",
          deadlineAt: Date.now() + 24 * HOUR,
          changeSummary: "",
          focusNotes: "",
          items: [
            {
              fileName: "big.indd",
              mimeType: "",
              type: "other",
              role: "source",
              declaredSize: 200_000_000,
            },
          ],
        }),
      ).rejects.toThrow(code("upload_file_too_large"));
    });
  });
});
