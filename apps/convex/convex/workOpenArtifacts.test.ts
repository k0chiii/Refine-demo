import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

/**
 * 校正画面は works.get → revisions.get → ファイルの順に待っていた。works.get が既定で開く版の添付の要約を返し、
 * 画面がファイルの取得を 1 回早く始められる（web の EditorPrefetch）。要約は revisions.get と同じ版・同じ添付で、認可も同じ。
 */
describe("Convex 統合: 既定で開く版の添付の要約（ファイルの先取り）", () => {
  it("works.get は受付中の版の添付 ID を revisions.get と同じ順で返し、版が無ければ null", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { mediaType: "pdf" });

    const empty = await cast.reviewer.as.query(api.works.get, { workId });
    expect(empty.defaultArtifacts).toBeNull();

    const { revisionId, artifacts } = await submitFiles(cast, workId, [
      { fileName: "表紙.pdf", mimeType: "application/pdf", type: "pdf" },
      { fileName: "表紙.png", mimeType: "image/png", type: "image" },
    ]);
    const work = await cast.reviewer.as.query(api.works.get, { workId });
    const rev = await cast.reviewer.as.query(api.revisions.get, { revisionId });
    expect(work.defaultArtifacts?.revisionId).toBe(revisionId);
    expect(work.defaultArtifacts?.artifacts.map((a) => a.id)).toEqual(artifacts.map((a) => a.id));
    expect(work.defaultArtifacts?.artifacts.map((a) => a.fileName)).toEqual([
      "表紙.pdf",
      "表紙.png",
    ]);
    // 添付を端末に残してよいかの判断に使う機密区分が、版の画面のデータに載る
    expect(rev.work.confidentiality).toBe("normal");
  });

  it("要約も works.get の認可の内側: 見られない人には存在ごと返さない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { confidentiality: "restricted" });
    await submitFiles(cast, workId, [
      { fileName: "a.pdf", mimeType: "application/pdf", type: "pdf" },
    ]);
    await expect(cast.stranger.as.query(api.works.get, { workId })).rejects.toThrow(
      code("forbidden"),
    );
    const ok = await cast.reviewer.as.query(api.works.get, { workId });
    expect(ok.work.confidentiality).toBe("restricted");
    expect(ok.defaultArtifacts?.artifacts).toHaveLength(1);
  });
});
