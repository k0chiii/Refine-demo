import { describe, expect, it } from "vite-plus/test";
import { check, consume, RATE_LIMITS } from "./rateLimit.ts";
import { migrate } from "./sqlite/schema.ts";
import { nodeSql } from "./testing/context.ts";

// @convex-dev/rate-limiter の token bucket と fixed window の意味を確かめる。設定の値は Convex の
// new RateLimiter(...)（processing.ts / ai.ts）と同じ

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 1);

const fresh = () => {
  const sql = nodeSql();
  migrate(sql);
  return sql;
};

describe("設定の値（Convex の new RateLimiter と同じ）", () => {
  it("AI は token bucket 6/分（満タン 2）と 12/分（満タン 3）、文字数は 20 万/日。処理は利用者 20/日・制作物 40/日", () => {
    expect(RATE_LIMITS).toEqual({
      aiUser: { kind: "token bucket", rate: 6, periodMs: MINUTE, capacity: 2 },
      aiWork: { kind: "token bucket", rate: 12, periodMs: MINUTE, capacity: 3 },
      aiCharacters: { kind: "fixed window", rate: 200_000, periodMs: DAY },
      processingUser: { kind: "fixed window", rate: 20, periodMs: DAY },
      processingWork: { kind: "fixed window", rate: 40, periodMs: DAY },
    });
  });
});

describe("token bucket（aiUser: 6/分、満タン 2）", () => {
  it("最初は満タンで、使い切ったら断る。待ち時間は足りない個数が貯まるまで（1 個 10 秒）", () => {
    const sql = fresh();
    expect(consume(sql, "aiUser", "u1", 1, T0)).toEqual({ ok: true });
    expect(consume(sql, "aiUser", "u1", 1, T0)).toEqual({ ok: true });
    expect(consume(sql, "aiUser", "u1", 1, T0)).toEqual({ ok: false, retryAfterMs: 10 * SECOND });
    expect(consume(sql, "aiUser", "u1", 2, T0)).toEqual({ ok: false, retryAfterMs: 20 * SECOND });
  });

  it("時間とともに補充される。待ち時間が来れば取れ、途中ならあとどれだけかを返す", () => {
    const sql = fresh();
    consume(sql, "aiUser", "u1", 2, T0);
    expect(consume(sql, "aiUser", "u1", 1, T0 + 4 * SECOND)).toEqual({
      ok: false,
      retryAfterMs: 6 * SECOND,
    });
    expect(consume(sql, "aiUser", "u1", 1, T0 + 10 * SECOND)).toEqual({ ok: true });
    // 断った試行は何も変えない（10 秒で貯まった 1 個を使ったので、また 10 秒）
    expect(consume(sql, "aiUser", "u1", 1, T0 + 10 * SECOND)).toEqual({
      ok: false,
      retryAfterMs: 10 * SECOND,
    });
  });

  it("長く空けても満タン（2）より貯まらない", () => {
    const sql = fresh();
    consume(sql, "aiUser", "u1", 2, T0);
    const later = T0 + 10 * MINUTE;
    expect(consume(sql, "aiUser", "u1", 2, later)).toEqual({ ok: true });
    expect(consume(sql, "aiUser", "u1", 1, later)).toEqual({
      ok: false,
      retryAfterMs: 10 * SECOND,
    });
  });

  it("key ごとに別の枠。満タンを超える要求は待っても通らないので投げる", () => {
    const sql = fresh();
    consume(sql, "aiUser", "u1", 2, T0);
    expect(consume(sql, "aiUser", "u2", 1, T0)).toEqual({ ok: true });
    // 同じ key でも name が違えば別の枠
    expect(consume(sql, "aiWork", "u1", 3, T0)).toEqual({ ok: true });
    expect(() => consume(sql, "aiUser", "u3", 3, T0)).toThrow("exceeds capacity");
  });
});

describe("fixed window（processingUser: 20/日）", () => {
  it("窓の中で使い切ったら断り、窓が明けるまでの時間を返す。明けたら全部戻る", () => {
    const sql = fresh();
    for (let n = 0; n < 20; n++)
      expect(consume(sql, "processingUser", "u1", 1, T0 + n)).toEqual({ ok: true });
    // 窓の始まりは最初に使った時刻（T0）
    expect(consume(sql, "processingUser", "u1", 1, T0 + HOUR)).toEqual({
      ok: false,
      retryAfterMs: DAY - HOUR,
    });
    expect(consume(sql, "processingUser", "u1", 1, T0 + DAY - 1)).toMatchObject({ ok: false });
    expect(consume(sql, "processingUser", "u1", 20, T0 + DAY)).toEqual({ ok: true });
    expect(consume(sql, "processingUser", "u1", 1, T0 + DAY)).toEqual({
      ok: false,
      retryAfterMs: DAY,
    });
  });

  it("何窓か空いても溜まらない（常に最大 20）。窓は前の窓の続きの刻みで数える", () => {
    const sql = fresh();
    consume(sql, "processingUser", "u1", 20, T0);
    // 3.5 窓あと: 窓の始まりは T0 + 3 日。そこから 20 個使えて、次の明けは T0 + 4 日
    const later = T0 + 3 * DAY + 12 * HOUR;
    expect(consume(sql, "processingUser", "u1", 20, later)).toEqual({ ok: true });
    expect(consume(sql, "processingUser", "u1", 1, later)).toEqual({
      ok: false,
      retryAfterMs: DAY / 2,
    });
  });

  it("文字数の枠は count ぶん減る（aiCharacters）", () => {
    const sql = fresh();
    expect(consume(sql, "aiCharacters", "u1", 150_000, T0)).toEqual({ ok: true });
    expect(consume(sql, "aiCharacters", "u1", 60_000, T0 + 1)).toEqual({
      ok: false,
      retryAfterMs: DAY - 1,
    });
    expect(consume(sql, "aiCharacters", "u1", 50_000, T0 + 1)).toEqual({ ok: true });
  });
});

describe("check（減らさずに見る）", () => {
  it("check は枠を減らさない。ai は全部の枠を check してから、まとめて consume する", () => {
    const sql = fresh();
    for (let n = 0; n < 5; n++) expect(check(sql, "aiUser", "u1", 2, T0)).toEqual({ ok: true });
    expect(consume(sql, "aiUser", "u1", 2, T0)).toEqual({ ok: true });
    expect(check(sql, "aiUser", "u1", 1, T0)).toEqual({ ok: false, retryAfterMs: 10 * SECOND });
  });
});
