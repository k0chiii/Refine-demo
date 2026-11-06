import { describe, expect, it } from "vite-plus/test";
import { canConfirm, failedItems, SubmissionFlow, type FlowDeps } from "./submissionFlow.ts";

class FakeFile {
  constructor(public name: string) {}
}
const file = (name: string) => new FakeFile(name) as unknown as File;

function makeDeps(behaviour: Record<string, "ok" | "fail" | "throw">) {
  const calls: string[] = [];
  const confirmed: string[] = [];
  let attempts: Record<string, number> = {};
  const deps: FlowDeps = {
    async prepare() {
      return {
        sessionId: "ses1",
        items: [
          { id: "a", fileName: "a.pdf", keyPrefix: "k/a" },
          { id: "b", fileName: "b.pdf", keyPrefix: "k/b" },
          { id: "ext", fileName: "figma", keyPrefix: null },
        ],
      };
    },
    async upload(itemId, _file, onProgress) {
      calls.push(`upload:${itemId}`);
      attempts[itemId] = (attempts[itemId] ?? 0) + 1;
      onProgress(0.5);
      const mode = attempts[itemId]! > 1 ? "ok" : (behaviour[itemId] ?? "ok");
      if (mode === "throw") throw new Error("ネットワーク切断");
      if (mode === "fail") return { status: "failed", failureMessage: "サイズ不一致" };
      return { status: "verified", failureMessage: null };
    },
    async reset(itemId) {
      calls.push(`reset:${itemId}`);
    },
    async confirm(sessionId, requestId) {
      confirmed.push(requestId);
      return {
        revisionId: `rev-${sessionId}`,
        sequence: 2,
        kind: "standard",
        supersededRevisionId: "rev-1",
      };
    },
    randomId: () => "req-fixed",
  };
  return { deps, calls, confirmed, reset: () => (attempts = {}) };
}

describe("SubmissionFlow（U-04 / A-02 / A-10）", () => {
  it("全ファイル成功で確定可能になり、外部リンクは転送しない", async () => {
    const { deps, calls } = makeDeps({});
    const flow = new SubmissionFlow(deps, [file("a.pdf"), file("b.pdf")]);
    await flow.start();
    expect(calls.sort()).toEqual(["upload:a", "upload:b"]);
    expect(flow.state.items.map((i) => i.status)).toEqual(["verified", "verified", "verified"]);
    expect(canConfirm(flow.state)).toBe(true);
  });

  it("A-02: 1件失敗すると確定できず、失敗したファイルと原因が分かる。再送後に確定できる", async () => {
    const { deps, calls, confirmed } = makeDeps({ b: "throw" });
    const flow = new SubmissionFlow(deps, [file("a.pdf"), file("b.pdf")]);
    await flow.start();
    expect(canConfirm(flow.state)).toBe(false);
    expect(failedItems(flow.state).map((i) => [i.fileName, i.error])).toEqual([
      ["b.pdf", "ネットワーク切断"],
    ]);
    await expect(flow.confirm()).rejects.toThrow();
    expect(confirmed).toEqual([]);

    await flow.retry("b");
    expect(calls).toContain("reset:b");
    expect(canConfirm(flow.state)).toBe(true);
    await flow.confirm();
    expect(flow.state.confirmed).toMatchObject({
      revisionId: "rev-ses1",
      supersededRevisionId: "rev-1",
    });
  });

  it("サーバー側で failed と判定されたファイルも失敗として扱う", async () => {
    const { deps } = makeDeps({ a: "fail" });
    const flow = new SubmissionFlow(deps, [file("a.pdf"), file("b.pdf")]);
    await flow.start();
    expect(failedItems(flow.state)[0]).toMatchObject({ itemId: "a", error: "サイズ不一致" });
  });

  it("A-10: 確定の再試行は同じ requestId を使う", async () => {
    const { deps, confirmed } = makeDeps({});
    let fail = true;
    const flaky: FlowDeps = {
      ...deps,
      async confirm(s, r) {
        if (fail) {
          fail = false;
          throw new Error("timeout");
        }
        return deps.confirm(s, r);
      },
    };
    const flow = new SubmissionFlow(flaky, [file("a.pdf"), file("b.pdf")]);
    await flow.start();
    await expect(flow.confirm()).rejects.toThrow("timeout");
    await flow.confirm();
    expect(confirmed).toEqual(["req-fixed"]);
  });

  it("Figma のフレームはファイルの後ろに並び、まとめて 1 回の取り込みで verified になる。失敗は項目ごとに再試行できる", async () => {
    const importCalls: string[][] = [];
    let failOnce = true;
    const deps: FlowDeps = {
      async prepare() {
        return {
          sessionId: "ses1",
          items: [
            { id: "a", fileName: "a.pdf", keyPrefix: "k/a" },
            { id: "f1", fileName: "figma-1-2.png", keyPrefix: "k/f1" },
            { id: "f2", fileName: "figma-3-4.png", keyPrefix: "k/f2" },
            { id: "ext", fileName: "https://www.figma.com/design/x", keyPrefix: null },
          ],
        };
      },
      async upload() {
        return { status: "verified", failureMessage: null };
      },
      async reset() {},
      async importFigma(items) {
        importCalls.push(items.map((i) => `${i.itemId}:${i.fileKey}:${i.nodeId}`));
        return items.map((i) => {
          if (i.itemId === "f2" && failOnce) {
            failOnce = false;
            return {
              itemId: i.itemId,
              status: "failed",
              failureMessage: "回数制限",
              nodeName: null,
            };
          }
          return {
            itemId: i.itemId,
            status: "verified",
            failureMessage: null,
            nodeName: `フレーム ${i.nodeId}`,
          };
        });
      },
      async confirm(sessionId, _requestId) {
        return {
          revisionId: `rev-${sessionId}`,
          sequence: 1,
          kind: "standard",
          supersededRevisionId: null,
        };
      },
      randomId: () => "req",
    };
    const flow = new SubmissionFlow(
      deps,
      [file("a.pdf")],
      [
        { fileKey: "KEY", nodeId: "1:2" },
        { fileKey: "KEY", nodeId: "3:4" },
      ],
    );
    await flow.start();
    expect(importCalls).toEqual([["f1:KEY:1:2", "f2:KEY:3:4"]]);
    expect(flow.state.items.map((i) => `${i.source}:${i.status}`)).toEqual([
      "file:verified",
      "figma:verified",
      "figma:failed",
      "external:verified",
    ]);
    expect(flow.state.items[1]!.fileName).toBe("フレーム 1:2.png");
    expect(failedItems(flow.state)[0]!.error).toBe("回数制限");
    expect(canConfirm(flow.state)).toBe(false);
    await flow.retry("f2");
    expect(importCalls[1]).toEqual(["f2:KEY:3:4"]);
    expect(canConfirm(flow.state)).toBe(true);
  });

  it("取り込みの口が無ければ Figma の項目は失敗として理由を出す", async () => {
    const { deps } = makeDeps({});
    const d2: FlowDeps = {
      ...deps,
      async prepare() {
        return { sessionId: "s", items: [{ id: "f1", fileName: "figma.png", keyPrefix: "k/f1" }] };
      },
    };
    const flow = new SubmissionFlow(d2, [], [{ fileKey: "KEY", nodeId: "1:2" }]);
    await flow.start();
    expect(flow.state.items[0]).toMatchObject({
      source: "figma",
      status: "failed",
      error: "Figma 連携が未設定です",
    });
  });
});
