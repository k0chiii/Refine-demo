import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createCast, createHarness } from "../test/harness";
import { setupWork, submitFiles } from "../test/flows";

const code = (c: string) => expect.objectContaining({ data: expect.objectContaining({ code: c }) });
const SITE = "https://example.invalid/";
const FIGMA = "https://www.figma.com/design/AbCdEfGhIjKl/MF100?node-id=12-34";

const webAnchor = (artifactId: string) => ({
  type: "web_element" as const,
  artifactId,
  url: "/events/",
  selector: { css: "main > section:nth-of-type(2) > h2", tag: "h2" },
  point: { x: 0.5, y: 0.5 },
  viewport: {
    width: 402,
    height: 874,
    dpr: 1,
    deviceId: "iphone-17",
    orientation: "portrait" as const,
  },
  fallback: { pageX: 201, pageY: 1430, scrollY: 1200 },
});

describe("Convex 統合: Web・Figma の校正（ライブ表示の要素・Figma のフレーム・取り込みの由来）", () => {
  it("サイトの URL を添付した版に web_element でコメント・FB を付けられる。実体の添付や Figma の添付には付けられない", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "公式サイト", mediaType: "web" });
    const { revisionId, artifacts } = await submitFiles(cast, workId, [
      { fileName: "top-iphone.png", mimeType: "image/png", type: "image" },
      { fileName: SITE, mimeType: "text/uri-list", type: "external_link", externalUrl: SITE },
      { fileName: FIGMA, mimeType: "text/uri-list", type: "external_link", externalUrl: FIGMA },
    ]);
    const site = artifacts.find((a) => a.externalUrl === SITE)!;
    const figma = artifacts.find((a) => a.externalUrl === FIGMA)!;
    const image = artifacts.find((a) => a.type === "image")!;
    expect(site.role).toBe("external");

    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: revisionId as Id<"revisions">,
      body: "見出しの表記",
      kind: "correction",
      severity: "major",
      anchor: webAnchor(site.id),
    });
    // 実体の添付・Figma の URL には web_element を付けられない
    await expect(
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: revisionId as Id<"revisions">,
        body: "x",
        kind: "correction",
        severity: "minor",
        anchor: webAnchor(image.id),
      }),
    ).rejects.toThrow(code("anchor_artifact_mismatch"));
    await expect(
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: revisionId as Id<"revisions">,
        body: "x",
        kind: "correction",
        severity: "minor",
        anchor: webAnchor(figma.id),
      }),
    ).rejects.toThrow(code("anchor_artifact_mismatch"));
    // 壊れた値（空のセレクタ）は拒否
    await expect(
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: revisionId as Id<"revisions">,
        body: "x",
        kind: "correction",
        severity: "minor",
        anchor: { ...webAnchor(site.id), selector: { css: "", tag: "h2" } },
      }),
    ).rejects.toThrow(code("anchor_invalid"));
    // Figma のフレーム単位のコメント（figma_node）は Figma の URL の添付にだけ
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: revisionId as Id<"revisions">,
      body: "このフレームの配色",
      kind: "correction",
      severity: "minor",
      anchor: {
        type: "figma_node",
        artifactId: figma.id,
        fileKey: "AbCdEfGhIjKl",
        nodeId: "12:34",
        nodeName: "ホーム",
      },
    });
    await expect(
      cast.reviewer.as.mutation(api.comments.post, {
        revisionId: revisionId as Id<"revisions">,
        body: "x",
        kind: "correction",
        severity: "minor",
        anchor: {
          type: "figma_node",
          artifactId: site.id,
          fileKey: "AbCdEfGhIjKl",
          nodeId: "12:34",
        },
      }),
    ).rejects.toThrow(code("anchor_artifact_mismatch"));
    const rev = await cast.reviewer.as.query(api.revisions.get, { revisionId });
    expect(
      rev.threads.map((x) => String(x.anchor?.type)).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["figma_node", "web_element"]);
  });

  it("Figma から取り込む項目: 準備時の由来（fileKey・nodeId）に、検証完了でノード名・版・大きさが入り、ファイル名はノード名になる", async () => {
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { title: "画面デザイン", mediaType: "figma" });
    const prepared = await cast.creator.as.mutation(api.submissions.prepare, {
      workId,
      kind: "standard",
      reviewType: "general",
      deadlineAt: Date.now() + 48 * 3_600_000,
      changeSummary: "Figma から",
      focusNotes: "",
      items: [
        {
          fileName: "figma-12-34.png",
          mimeType: "image/png",
          type: "image",
          role: "source",
          origin: {
            kind: "figma",
            fileKey: "AbCdEfGhIjKl",
            nodeId: "12:34",
            scale: 2,
            box: { width: 0, height: 0 },
          },
        },
        {
          fileName: FIGMA,
          mimeType: "text/uri-list",
          type: "external_link",
          role: "external",
          externalUrl: FIGMA,
        },
      ],
    });
    const item = prepared.items[0]!;
    const { attemptId } = await cast.creator.as.mutation(internal.submissions.beginUpload, {
      itemId: item.id,
    });
    const done = await cast.creator.as.mutation(internal.submissions.completeUpload, {
      attemptId,
      size: 1234,
      sha256: "a".repeat(64),
      figma: {
        nodeName: "ホーム（スマホ）",
        figmaVersion: "123",
        lastModified: "2026-10-17T00:00:00Z",
        box: { width: 402, height: 874 },
      },
    });
    expect(done.status).toBe("verified");
    const confirmed = await cast.creator.as.mutation(api.submissions.confirm, {
      sessionId: prepared.sessionId as Id<"uploadSessions">,
    });
    const rev = await cast.creator.as.query(api.revisions.get, {
      revisionId: confirmed.revisionId,
    });
    const img = rev.artifacts.find((a) => a.type === "image")!;
    expect(img.fileName).toBe("ホーム（スマホ）.png");
    expect(img.origin).toEqual({
      kind: "figma",
      fileKey: "AbCdEfGhIjKl",
      nodeId: "12:34",
      nodeName: "ホーム（スマホ）",
      figmaVersion: "123",
      lastModified: "2026-10-17T00:00:00Z",
      scale: 2,
      box: { width: 402, height: 874 },
    });
    // 取り込んだ画像には従来どおり画像の位置でコメント
    await cast.reviewer.as.mutation(api.comments.post, {
      revisionId: confirmed.revisionId as Id<"revisions">,
      body: "ボタンの色",
      kind: "correction",
      severity: "minor",
      anchor: { type: "image_pin", artifactId: img.id, point: { x: 0.5, y: 0.8 } },
    });
  });
});
