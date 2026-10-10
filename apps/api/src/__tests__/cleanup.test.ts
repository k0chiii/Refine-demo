import { describe, expect, it } from "vite-plus/test";
import { purgeOrphanObjects } from "../cleanup.ts";
import type { CleanupGateway } from "../ports.ts";
import { MemoryStore } from "./fakes.ts";

class FakeCleanupGateway implements CleanupGateway {
  orphans: Array<{ itemId: string; objectKey: string }> = [];
  purged: string[][] = [];
  async listOrphans(limit: number) {
    return this.orphans.slice(0, limit);
  }
  async markPurged(itemIds: string[]) {
    this.purged.push(itemIds);
    return itemIds.length;
  }
}

describe("R2 孤立オブジェクトの清掃（D14）", () => {
  it("列挙されたキーだけを削除し、成功分だけを記録する。失敗分は次回に残る", async () => {
    const store = new MemoryStore();
    const put = (key: string) =>
      store.objects.set(key, { bytes: new Uint8Array([1]), contentType: "application/pdf" });
    put("works/w1/sessions/s1/0-a.pdf");
    put("works/w1/sessions/s1/1-b.pdf");
    put("works/w1/sessions/s2/0-keep.pdf"); // 列挙されていない（確定済み）→ 残る
    const gateway = new FakeCleanupGateway();
    gateway.orphans = [
      { itemId: "i1", objectKey: "works/w1/sessions/s1/0-a.pdf" },
      { itemId: "i2", objectKey: "works/w1/sessions/s1/1-b.pdf" },
      { itemId: "i3", objectKey: "works/w1/sessions/s1/2-missing.pdf" }, // 既に無い → 削除は冪等に成功
    ];
    const original = store.delete.bind(store);
    store.delete = async (key: string) => {
      if (key.endsWith("1-b.pdf")) throw new Error("R2 unavailable");
      await original(key);
    };
    const result = await purgeOrphanObjects({ gateway, store }, 10);
    expect(result).toEqual({
      listed: 3,
      purged: 2,
      failed: [{ itemId: "i2", message: "R2 unavailable" }],
    });
    expect(gateway.purged).toEqual([["i1", "i3"]]);
    expect([...store.objects.keys()]).toEqual([
      "works/w1/sessions/s1/1-b.pdf",
      "works/w1/sessions/s2/0-keep.pdf",
    ]);
  });

  it("対象が無ければ記録 API を呼ばない", async () => {
    const gateway = new FakeCleanupGateway();
    const result = await purgeOrphanObjects({ gateway, store: new MemoryStore() });
    expect(result).toEqual({ listed: 0, purged: 0, failed: [] });
    expect(gateway.purged).toEqual([]);
  });
});
