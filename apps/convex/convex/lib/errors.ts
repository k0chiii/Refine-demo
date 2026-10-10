import { isDomainError } from "@mf100/domain";
import { ConvexError, type Value } from "convex/values";

/**
 * ドメイン例外を ConvexError に変換してクライアントへ返す。
 * code はドメインのエラーコードそのまま。details には個人情報・本文を含めない前提（原因箇所の ID やファイル名のみ）。
 */
export function toConvexError(error: unknown): never {
  if (isDomainError(error)) {
    throw new ConvexError({ code: error.code, details: error.details as unknown as Value });
  }
  throw error;
}

export async function runUseCase<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return toConvexError(error);
  }
}

export function unauthenticated(): never {
  throw new ConvexError({ code: "unauthenticated", details: {} });
}
