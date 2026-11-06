import type { AiCandidate } from "@mf100/domain";
import type { AiProofreadInput, AiProofreadProvider } from "./provider";

/** Binding-backed Worker endpoint; the Worker never gets an application JWT. */
export class WorkersAiProofreader implements AiProofreadProvider {
  readonly name = "Workers AI";
  constructor(readonly model: string) {}
  async proofread(input: AiProofreadInput): Promise<AiCandidate[]> {
    const endpoint = process.env.WORKERS_AI_URL;
    const secret = process.env.WORKERS_AI_SECRET;
    if (!endpoint || !secret || secret.length < 32) throw new Error("workers_ai_not_configured");
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/internal/ai/proofread"
    )
      throw new Error("invalid_workers_ai_url");
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, model: this.model }),
    });
    if (!response.ok) throw new Error(`workers_ai_${response.status}`);
    const result = (await response.json()) as { candidates: AiCandidate[] };
    return result.candidates;
  }
}
