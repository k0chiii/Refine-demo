import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "./_generated/api";
import { createCast, createHarness } from "../test/harness";
import { setupWork } from "../test/flows";

afterEach(() => vi.useRealTimers());
describe("authorized work presence", () => {
  it("merges multiple tabs and requires current ACL on every list and heartbeat", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const t = createHarness();
    const cast = await createCast(t);
    const workId = await setupWork(t, cast, { confidentiality: "restricted" });
    const first = await cast.creator.as.mutation(api.presence.heartbeat, {
      workId,
      sessionId: crypto.randomUUID(),
    });
    await cast.creator.as.mutation(api.presence.heartbeat, {
      workId,
      sessionId: crypto.randomUUID(),
    });
    expect(await cast.manager.as.query(api.presence.list, { workId })).toHaveLength(1);
    await cast.creator.as.mutation(api.presence.disconnect, { sessionToken: first.sessionToken });
    expect(await cast.manager.as.query(api.presence.list, { workId })).toHaveLength(1);
    await expect(cast.stranger.as.query(api.presence.list, { workId })).rejects.toThrow();
    await expect(
      cast.stranger.as.mutation(api.presence.heartbeat, { workId, sessionId: crypto.randomUUID() }),
    ).rejects.toThrow();
  });
});
