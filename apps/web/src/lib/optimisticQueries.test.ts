import { describe, expect, it } from "vite-plus/test";
import { makeFunctionReference } from "convex/server";
import { OptimisticQueries } from "./optimisticQueries";

const query = makeFunctionReference<"query", { id: string }, boolean>("test:pinned");
describe("optimistic mutations", () => {
  it("keeps concurrent overlays independent and rolls back failures", () => {
    const cache = new OptimisticQueries();
    cache.remember(query, { id: "a" }, false);
    cache.remember(query, { id: "b" }, false);
    const first = cache.begin((store, args: { id: string }) => store.setQuery(query, args, true), {
      id: "a",
    });
    const second = cache.begin((store, args: { id: string }) => store.setQuery(query, args, true), {
      id: "b",
    });
    expect(cache.read(query, { id: "a" })).toBe(true);
    first();
    expect(cache.read(query, { id: "a" })).toBe(false);
    expect(cache.read(query, { id: "b" })).toBe(true);
    cache.remember(query, { id: "b" }, true);
    second();
    expect(cache.read(query, { id: "b" })).toBe(true);
    cache.clear();
    expect(cache.read(query, { id: "b" })).toBeUndefined();
  });
});
