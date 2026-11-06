/**
 * `node:async_hooks` の AsyncLocalStorage をブラウザ向けに最小実装する（デモモード専用）。
 * convex-test は複数のストアを入れ子で使うが、デモモードでは全ての Convex 呼び出しを 1 本のキューで直列化するため、
 * 「run 中は常にスタック先頭が現在値」という単純な LIFO で十分に動く。並行実行には対応しない。
 */
export class AsyncLocalStorage<T> {
  private readonly stack: T[] = [];

  getStore(): T | undefined {
    return this.stack[this.stack.length - 1];
  }

  async run<R>(
    store: T,
    fn: (...args: unknown[]) => R | Promise<R>,
    ...args: unknown[]
  ): Promise<R> {
    this.stack.push(store);
    try {
      return await fn(...args);
    } finally {
      const idx = this.stack.lastIndexOf(store);
      if (idx >= 0) this.stack.splice(idx, 1);
    }
  }

  enterWith(store: T): void {
    this.stack.push(store);
  }

  exit<R>(fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    const saved = this.stack.splice(0);
    try {
      return fn(...args);
    } finally {
      this.stack.push(...saved);
    }
  }

  disable(): void {
    this.stack.length = 0;
  }
}
