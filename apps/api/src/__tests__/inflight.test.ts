import { describe, expect, it } from "vite-plus/test";
import { createCoalescer } from "../inflight.ts";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("実行中の同じ問い合わせをまとめる（認可の結果は残さない）", () => {
  it("実行中の同じキーは 1 回だけ実行し、結果を共有する", async () => {
    const coalesce = createCoalescer();
    const d = deferred<string>();
    let runs = 0;
    const run = () => {
      runs++;
      return d.promise;
    };
    const a = coalesce("k", run);
    const b = coalesce("k", run);
    d.resolve("ok");
    expect(await Promise.all([a, b])).toEqual(["ok", "ok"]);
    expect(runs).toBe(1);
  });

  it("終わったら結果を残さない: 次の呼び出しは必ず新しく実行する（権限剥奪が次の要求から効く）", async () => {
    const coalesce = createCoalescer();
    let allowed = true;
    const run = async () => {
      if (!allowed) throw new Error("forbidden");
      return "ok";
    };
    expect(await coalesce("k", run)).toBe("ok");
    allowed = false;
    await expect(coalesce("k", run)).rejects.toThrow("forbidden");
  });

  it("キーが違えば（利用者・添付が違えば）まとめない。失敗も共有し、失敗の後は残らない", async () => {
    const coalesce = createCoalescer();
    const d = deferred<string>();
    let runs = 0;
    const a = coalesce("user1", () => {
      runs++;
      return d.promise;
    });
    const b = coalesce("user2", async () => {
      runs++;
      return "other";
    });
    expect(await b).toBe("other");
    d.reject(new Error("boom"));
    await expect(a).rejects.toThrow("boom");
    expect(runs).toBe(2);
    expect(await coalesce("user1", async () => "again")).toBe("again");
  });
});
