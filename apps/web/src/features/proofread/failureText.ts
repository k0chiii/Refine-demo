import { describeError } from "@/lib/errors";

/** 自動校正の失敗として記録する文言 */
export function failureText(error: unknown): string {
  return describeError(error).message;
}
