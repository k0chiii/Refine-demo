import type { AiCandidate, AiPolicy, EffectiveRule } from "@mf100/domain";

/**
 * AI 校正の提供元の抽象。提供元を替えても、呼び出し側（権限・機密区分・候補の確認）は変わらない。
 * API キーはサーバーの環境変数だけに置く（ブラウザには渡さない）。
 */
export interface AiProofreadInput {
  text: string;
  rules: readonly Pick<
    EffectiveRule,
    "ruleId" | "title" | "correct" | "incorrect" | "description"
  >[];
}
export interface AiProofreadProvider {
  /** 画面に出す送り先の名前（例: Anthropic） */
  readonly name: string;
  readonly model: string;
  proofread(input: AiProofreadInput): Promise<AiCandidate[]>;
}

export interface AiConfig {
  policy: AiPolicy;
  provider: string;
  model: string;
}

/** 環境変数から設定を読む。キーが無ければ無効 */
export function aiConfig(): AiConfig {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const hasKey = provider === "anthropic" && !!process.env.ANTHROPIC_API_KEY;
  return {
    provider,
    model: process.env.AI_MODEL ?? "claude-opus-5-5",
    policy: {
      enabled: hasKey && process.env.AI_PROOFREAD_ENABLED !== "false",
      allowRestricted: process.env.AI_ALLOW_RESTRICTED === "true",
      maxChars: Number(process.env.AI_MAX_CHARS ?? 20_000) || 20_000,
    },
  };
}

/** 提供元を作る（SDK は使うときだけ読み込む） */
export async function createProvider(config: AiConfig): Promise<AiProofreadProvider> {
  if (config.provider === "anthropic") {
    const { AnthropicProofreader } = await import("./anthropic.ts");
    return new AnthropicProofreader(config.model);
  }
  throw new Error(`unknown AI provider: ${config.provider}`);
}
