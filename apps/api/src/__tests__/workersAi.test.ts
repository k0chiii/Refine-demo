import { expect, it, vi } from "vite-plus/test";
import { workersAi } from "../workersAi";
it("Workers AI は秘密・固定モデル・構造化候補を確認する", async () => {
  const run = vi.fn(async () => ({ response: JSON.stringify({ candidates: [] }) }));
  const secret = "x".repeat(32);
  const model = "fixed-model";
  const request = (authorization: string, chosen = model) =>
    new Request("https://api.test/internal/ai/proofread", {
      method: "POST",
      headers: { Authorization: authorization },
      body: JSON.stringify({ text: "五月祭", rules: [], model: chosen }),
    });
  expect((await workersAi(request("wrong"), { AI: { run }, secret, model })).status).toBe(404);
  expect(run).not.toHaveBeenCalled();
  expect(
    (await workersAi(request(`Bearer ${secret}`, "other"), { AI: { run }, secret, model })).status,
  ).toBe(400);
  expect(
    (await workersAi(request(`Bearer ${secret}`), { AI: { run }, secret, model })).status,
  ).toBe(200);
  run.mockResolvedValueOnce({ response: JSON.stringify({ candidates: [{ original: 1 }] }) });
  expect(
    (await workersAi(request(`Bearer ${secret}`), { AI: { run }, secret, model })).status,
  ).toBe(502);
});
