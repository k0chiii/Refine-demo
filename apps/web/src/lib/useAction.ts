import { useCallback, useState } from "react";
import { describeError } from "./errors";
import { toast } from "./toast";

/** mutation 実行の共通ラッパ。失敗は利用者向けメッセージで通知し、二重送信を防ぐ。 */
export function useAction<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ReturnType<typeof describeError> | null>(null);
  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      if (pending) return undefined;
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (e) {
        const described = describeError(e);
        setError(described);
        toast(described.message, { kind: "error" });
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn, pending],
  );
  return { run, pending, error };
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
