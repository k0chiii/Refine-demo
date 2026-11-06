import type { usecases } from "./registry.ts";

type Rest<F> = F extends (ctx: never, principal: never, ...args: infer A) => unknown ? A : never;
type Result<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;

export type Usecases = typeof usecases;

/** 呼び出し側（web）のための型付きの口。`hc` の代わりに名前で引く（経路は /u/:name の 1 本だけ） */
export function createClient(
  baseUrl: string,
  init: { headers?: HeadersInit; fetch?: typeof fetch } = {},
) {
  const doFetch = init.fetch ?? fetch;
  return async <K extends keyof Usecases>(
    name: K,
    ...args: Rest<Usecases[K]>
  ): Promise<Result<Usecases[K]>> => {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    const res = await doFetch(`${baseUrl.replace(/\/$/, "")}/u/${name}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ args }),
    });
    const body: unknown = await res.json();
    if (!res.ok)
      throw new ClientError(res.status, body as { code: string; details: Record<string, unknown> });
    return body as Result<Usecases[K]>;
  };
}

export class ClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: { code: string; details: Record<string, unknown> },
  ) {
    super(body.code);
    this.name = "ClientError";
  }
}
