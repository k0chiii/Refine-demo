import { describe, expect, it } from "vite-plus/test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });

describe("Convex 統合: 動画の校正（時点・範囲・画面の位置）", () => {
  it("動画を提出し、時点と範囲（画面の矩形付き）でコメントと FB を付けられる。壊れた時刻は拒否", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "MF100 告知動画", mediaType: "video" });
    const { revisionId, artifacts } = await submitFiles(cast, workId, [
      { fileName: "teaser.mp4", mimeType: "video/mp4", type: "video" },
      { fileName: "cover.png", mimeType: "image/png", type: "image" },
    ]);
    const video = artifacts.find((a) => a.type === "video")!;
    expect(video).toMatchObject({ fileName: "teaser.mp4", mimeType: "video/mp4" });

    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: revisionId as Id<"revisions">,
      body: "ここで音が途切れる",
      kind: "correction",
      severity: "major",
      anchor: { type: "video_time", artifactId: video.id, start: 4.25 },
    });
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: revisionId as Id<"revisions">,
      body: "テロップの表記ゆれ",
      kind: "correction",
      severity: "minor",
      anchor: {
        type: "video_time",
        artifactId: video.id,
        start: 6,
        end: 9.5,
        rect: { x: 0.1, y: 0.75, w: 0.8, h: 0.15 },
      },
    });
    await expect(
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: revisionId as Id<"revisions">,
        body: "x",
        kind: "correction",
        severity: "minor",
        anchor: { type: "video_time", artifactId: video.id, start: -1 },
      }),
    ).rejects.toThrow(code("anchor_invalid"));

    const rev = await cast.reviewer.as.query(api.revisions.get, { revisionId });
    expect(rev.work.mediaType).toBe("video");
    expect(rev.threads.map((x) => x.anchor)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "video_time", start: 4.25 }),
        expect.objectContaining({ type: "video_time", start: 6, end: 9.5 }),
      ]),
    );
  });
});
