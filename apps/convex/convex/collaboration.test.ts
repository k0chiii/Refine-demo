import { describe, expect, it } from "vite-plus/test";
import type { Id } from "./_generated/dataModel";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { documentText } from "./collaboration";

const doc = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

describe("共同編集", () => {
  it("既存原稿を保持し、閲覧と編集を認可し、古いクライアントの保存を拒否する", async () => {
    const t = createHarness();
    const c = await createCast(t);
    const workId = (await c.manager.as.mutation(api.works.create, {
      title: "原稿",
      purpose: "案内",
      category: "文章",
      mediaType: "document",
      year: 100,
      creatorIds: [c.creator.id],
      approverId: c.approver.id,
    })) as Id<"works">;
    await c.creator.as.mutation(api.documents.save, {
      workId,
      title: "原稿",
      content: doc("元の原稿"),
      text: "元の原稿",
      baseVersion: 0,
    });
    await c.creator.as.mutation(api.collaboration.enable, { workId });
    await c.creator.as.mutation(api.collaboration.enable, { workId });
    expect(await c.creator.as.query(api.collaboration.getSnapshot, { id: workId })).toMatchObject({
      version: 1,
      content: doc("元の原稿"),
    });
    expect((await c.creator.as.query(api.documents.get, { workId })).collaborative).toBe(true);
    expect(await c.stranger.as.query(api.collaboration.getSnapshot, { id: workId })).toMatchObject({
      version: 1,
    });
    await expect(
      c.approver.as.mutation(api.collaboration.submitSteps, {
        id: workId,
        version: 1,
        clientId: "reader",
        steps: [],
      }),
    ).rejects.toThrow();
    await expect(
      c.creator.as.mutation(api.documents.save, {
        workId,
        title: "古い原稿",
        content: doc("上書き"),
        text: "上書き",
        baseVersion: 1,
      }),
    ).rejects.toThrow("collaborative_draft_requires_sync");
    const step = JSON.stringify({
      stepType: "replace",
      from: 1,
      to: 1,
      slice: { content: [{ type: "text", text: "追記" }] },
    });
    expect(
      await c.creator.as.mutation(api.collaboration.submitSteps, {
        id: workId,
        version: 1,
        clientId: "a",
        steps: [step],
      }),
    ).toMatchObject({ status: "synced" });
    expect(
      await c.creator.as.mutation(api.collaboration.submitSteps, {
        id: workId,
        version: 1,
        clientId: "b",
        steps: [step],
      }),
    ).toMatchObject({ status: "needs-rebase" });
    await c.creator.as.mutation(api.collaboration.submitSnapshot, {
      id: workId,
      version: 2,
      content: doc("追記元の原稿"),
    });
    expect((await c.creator.as.query(api.documents.get, { workId })).draft).toMatchObject({
      text: "追記元の原稿",
      version: 2,
    });
  });

  it("スナップショットの改行を抽出し、不正・過大な文書を拒否する", () => {
    expect(
      documentText(
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "甲" },
                { type: "hardBreak" },
                { type: "text", text: "乙" },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "丙" }] },
          ],
        }),
      ),
    ).toBe("甲\n乙\n丙");
    expect(() => documentText('{"type":"text","text":"x"}')).toThrow();
    expect(() => documentText("x".repeat(2_000_001))).toThrow("document_too_large");
  });
});
