import type { AppContext } from "@mf100/application";
import { DomainError, type DomainErrorCode, type Principal } from "@mf100/domain";
import type { z } from "zod";
import type { Job } from "../jobs.ts";
import type { Sql } from "../sqlite/sql.ts";

export type Kind = "query" | "mutation" | "action";

export type ServiceSecret = "MF100_UPLOAD_SECRET" | "MF100_CLEANUP_SECRET" | "PROCESSING_SECRET";

/**
 * 誰が呼べるか。Convex の「関数の種類 + http.ts の認証」を 1 か所に寄せたもの。
 * - user: 利用者の JWT 必須（Convex の requireUser）
 * - optional: 居れば主体、無ければ null（optionalUser）
 * - public: 認証なし（works:ogSummary）
 * - service: 共有秘密を持つサービスだけ（http.ts の 3 方式）。withUser なら利用者の JWT も要り、その主体のまま動く
 */
export type Auth = "user" | "optional" | "public" | { service: ServiceSecret; withUser: boolean };

export interface FnCtx {
  /** application のポート（SQLite のアダプタ） */
  db: AppContext;
  /** 生の SQL。ポートに無い読み取りを書くときだけ。読んだ表・書いた表はここからも拾われる */
  sql: Sql;
  /** 主体。public と、利用者無しの service では null */
  principal: Principal | null;
  /** users.id（= principal.userId）。主体が無ければ null */
  userId: string | null;
  env: Env;
  now: () => number;
  /** あとで動く仕事を、この呼び出しと同じトランザクションで積む（巻き戻れば消える。src/jobs.ts） */
  schedule: (job: Job) => void;
}

export interface FnDef<A = unknown, R = unknown> {
  kind: Kind;
  auth: Auth;
  args: z.ZodType<A>;
  handler(ctx: FnCtx, args: A): Promise<R>;
}

/**
 * zod 4 の optional は `x?: T | undefined` を作るが、application の入力は exactOptionalPropertyTypes で `x?: T`。
 * JSON から来る値に undefined は入らない（zod も欠けた鍵は欠けたまま返す）ので、型だけ外す
 */
export type Exact<T> =
  T extends ReadonlyArray<infer U>
    ? Exact<U>[]
    : T extends object
      ? { [K in keyof T]: Exact<Exclude<T[K], undefined>> }
      : T;

interface Spec<S extends z.ZodType, R> {
  auth: Auth;
  args: S;
  handler(ctx: FnCtx, args: Exact<z.output<S>>): Promise<R>;
}

/** 型を付けるだけ。kind は関数の名前（query / mutation / action）が決める */
function define(kind: Kind) {
  return <S extends z.ZodType, R>(spec: Spec<S, R>): FnDef<Exact<z.output<S>>, R> =>
    // ponytail: zod の出力型（Exact 前）と Exact 後は実行時に同じ値。型の橋だけ cast で渡す
    ({ kind, ...spec }) as unknown as FnDef<Exact<z.output<S>>, R>;
}

export const query = define("query");
export const mutation = define("mutation");
export const action = define("action");

/**
 * ponytail: domain のコード表に無い失敗（Convex は素の Error の message で運ぶもの）を、code のまま返すために cast する。
 * 素の Error のままだと run.ts が 500 にしてしまう。run.ts は code をそのまま返し、statusOf は *_not_found を 404、他を 400 にする。
 * 表に足せたものから足していく
 */
export const reject = (code: string, details: Record<string, unknown> = {}): DomainError =>
  new DomainError(code as DomainErrorCode, details);
