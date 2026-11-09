export interface ConvexWorld {
  /** users 行を作って ID を返す（Nogiku モックでサインインした人と同じ形） */
  createUser(name: string, email: string, isSystemAdmin: boolean): Promise<string>;
  /** userId が null なら未サインイン。service は internal 関数（Hono が呼ぶ口） */
  call(
    userId: string | null,
    kind: "query" | "mutation",
    name: string,
    args: unknown,
    service?: boolean,
  ): Promise<{ ok: true; value: unknown } | { ok: false; code: string }>;
  setNow(ms: number): void;
  close(): void;
}
export function createConvexWorld(startAt: number): ConvexWorld;
