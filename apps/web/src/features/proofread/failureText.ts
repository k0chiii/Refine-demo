import { ConvexError } from "convex/values";
import { describeError } from "@/lib/errors";

/**
 * 自動校正の失敗として記録する文言。利用者向けの文言に、原因を追える元の文言を添える
 * （英語のメッセージは決まった文言に置き換わり、理由が分からなくなるため）。
 */
export function failureText(error: unknown): string {
  const { code, message } = describeError(error);
  if (error instanceof ConvexError)
    return message.includes(code) ? message : `${message}（コード: ${code}）`;
  if (error instanceof Error) {
    const original = error.message || error.name;
    return message === error.message || !original ? message : `${message}（${original}）`;
  }
  return message;
}
