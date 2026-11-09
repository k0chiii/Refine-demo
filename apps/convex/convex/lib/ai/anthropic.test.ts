import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AnthropicProofreader } from "./anthropic.ts";

const input = {
  text: "5月に開催",
  rules: [{ ruleId: "A1-0001", title: "", correct: ["五月"], incorrect: ["5月"], description: "" }],
};

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllEnvs());

describe("AnthropicProofreader（素の fetch）", () => {
  it("messages API に model・ルール・本文を送り、候補を返す", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("AI_GATEWAY_URL", "");
    const candidates = [
      { original: "5月", suggestion: "五月", reason: "漢数字", ruleId: "A1-0001" },
    ];
    const fetcher = reply({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ candidates }) }],
    });
    const out = await new AnthropicProofreader("claude-opus-5-5", fetcher).proofread(input);
    expect(out).toEqual(candidates);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.messages[0].content).toContain("A1-0001: 五月 ← 5月");
    expect(sent.messages[0].content).toContain("<本文>\n5月に開催\n</本文>");
  });

  it("断り・途中切れ・HTTP エラー・キー無しは失敗にする", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("AI_GATEWAY_URL", "");
    const run = (fetcher: typeof fetch) => new AnthropicProofreader("m", fetcher).proofread(input);
    await expect(run(reply({ stop_reason: "refusal", content: [] }))).rejects.toThrow("断りました");
    await expect(run(reply({ stop_reason: "max_tokens", content: [] }))).rejects.toThrow("途中で");
    await expect(run(reply({}, 529))).rejects.toThrow("anthropic_529");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(run(reply({}))).rejects.toThrow("anthropic_not_configured");
  });
});
