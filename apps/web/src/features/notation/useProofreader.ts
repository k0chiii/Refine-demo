import {
  proofread,
  type EffectiveRule,
  type ProofreadOptions,
  type ProofreadResult,
} from "@mf100/domain";
import { useEffect, useRef } from "react";

/**
 * 表記の検査を Web Worker で行う。Worker が使えない環境ではメインスレッドで行う（結果は同じ）。
 * 返す関数は最後に頼んだ検査の結果だけを解決する（古い結果で上書きしない）。
 */
export function useProofreader(rules: readonly EffectiveRule[] | null) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const pending = useRef(new Map<number, (r: ProofreadResult) => void>());
  const rulesRef = useRef<readonly EffectiveRule[]>([]);

  useEffect(() => {
    try {
      const w = new Worker(new URL("./proofread.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<ProofreadResult & { id: number }>) => {
        const done = pending.current.get(e.data.id);
        pending.current.delete(e.data.id);
        done?.(e.data);
      };
      w.onerror = () => {
        // 読み込めなければメインスレッドへ切り替える
        worker.current = null;
        for (const [, resolve] of pending.current)
          resolve({ findings: [], skipped: [], truncated: true });
        pending.current.clear();
      };
      worker.current = w;
      w.postMessage({ type: "rules", rules: rulesRef.current });
    } catch {
      worker.current = null;
    }
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    rulesRef.current = rules ?? [];
    worker.current?.postMessage({ type: "rules", rules: rulesRef.current });
  }, [rules]);

  return (text: string, opts?: ProofreadOptions): Promise<ProofreadResult> => {
    const id = ++seq.current;
    const w = worker.current;
    if (!w)
      return Promise.resolve(proofread(text, rulesRef.current, { timeBudgetMs: 1500, ...opts }));
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      w.postMessage({ type: "check", id, text, ...(opts ? { opts } : {}) });
    });
  };
}
