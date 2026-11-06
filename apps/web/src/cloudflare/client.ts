/**
 * `--mode cloudflare` の通信の正本（Convex の代わりに apps/cloudflare の Hono + Durable Object へ向ける）。
 * 画面のコードは `convex/react` / `@convex-dev/auth/react` の hook しか知らないので、その表面は
 * convexReact.ts / convexAuthReact.tsx が作り、実際の fetch・WebSocket・トークンはすべてここに置く。
 *
 * - 呼び出し: `POST /f/<module>:<fn>`。query は `{ value, reads }`、mutation / action は `{ value }`、失敗は `{ code, details }`
 * - 購読: `GET /ws?token=` に 1 本。書いた表の名前（`{ changed }`）が来たら、`reads` が交わる query だけ読み直す
 * - 認証: access / refresh を localStorage に持つ。期限の 5 分前か 401 で更新する
 */
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError, type Value } from "convex/values";
import { OptimisticQueries } from "../lib/optimisticQueries";
import { jwtUser } from "../lib/jwt";

const STORAGE_KEY = "mf100.cloudflare.session";
const LOCK_NAME = "mf100.cloudflare.refresh";
/** サインインを始めたタブだけが持つ verifier（一時コードの引き換えに要る。localStorage には置かない） */
const VERIFIER_KEY = "mf100.cloudflare.verifier";
/** 期限のこの手前で更新する（呼び出しの途中で切れないように） */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** 使われなくなった購読を、この間は持っておく（StrictMode の付け外し・画面遷移の往復で読み直さないため） */
const KEEP_MS = 10_000;

interface Session {
  access: string;
  refresh: string;
  /** access の期限（ms。JWT の exp） */
  expiresAt: number;
}

export interface AuthState {
  status: "loading" | "authenticated" | "anonymous";
  token: string | null;
}

type Args = Record<string, Value>;
type QueryRef = FunctionReference<"query">;

/** 共有する楽観的更新の置き場（Convex の localStore の代わり。demo と同じ lib/optimisticQueries） */
export const optimistic = new OptimisticQueries();

/** access token の期限（exp, ms）。読めなければ 55 分後（サーバーは 1 時間） */
function expiryOf(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (payload) {
      const exp = (
        JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown }
      ).exp;
      if (typeof exp === "number") return exp * 1000;
    }
  } catch {
    // 読めない
  }
  return Date.now() + 55 * 60_000;
}

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    return typeof s.access === "string" &&
      typeof s.refresh === "string" &&
      typeof s.expiresAt === "number"
      ? { access: s.access, refresh: s.refresh, expiresAt: s.expiresAt }
      : null;
  } catch {
    return null;
  }
}

function writeStored(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 保存できなくても、このタブの中では動く
  }
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** PKCE と同じ形: 乱数の verifier と、その SHA-256 の challenge。challenge だけがサーバーへ行く */
async function newPkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** 取り出したら消す（1 回きり）。無ければ、このタブが始めたサインインではない */
function takeVerifier(): string | null {
  try {
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    return verifier;
  } catch {
    return null;
  }
}

/** 戻りの URL の `?code=`（Nogiku のあと Worker が返す一時コード）を取り、URL から消す。アドレスバーに残さない */
function takeCodeFromUrl(): string | null {
  if (typeof location === "undefined") return null;
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;
  url.searchParams.delete("code");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  return code;
}

/**
 * 1 つの問い合わせ（または 1 つの一覧）の読み取りと購読。値・読んだ表・読み直しの状態を持つ。
 * 画面が使っている間（listeners がある間）だけ「生きている」。生きているものだけが、通知で読み直される。
 */
export interface EntryState<T = unknown> {
  value: T | undefined;
  loaded: boolean;
  error: unknown;
}

class Entry<T = unknown> {
  readonly listeners = new Set<() => void>();
  state: EntryState<T> = { value: undefined, loaded: false, error: undefined };
  /** 前回読んだ表の名前。ここに通知の表が交われば読み直す */
  reads: ReadonlySet<string> = new Set();
  /** 一覧のページ数（query では常に 1 で使わない） */
  requestedPages = 1;
  /** 生きていない間に表が変わった。次に使われたとき読み直す */
  private stale = false;
  private running: Promise<void> | null = null;
  private again = false;
  private generation = 0;
  private text: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly client: CloudflareClient,
    readonly key: string,
    private readonly load: (entry: Entry<T>) => Promise<{ value: T; reads: Iterable<string> }>,
    /** 楽観的更新の土台に写す（query のみ） */
    private readonly remember?: (value: T) => void,
  ) {
    // 誰にも使われないまま作られた分（描画の中断など）も、時間が来たら捨てる
    this.expireSoon();
  }

  get live() {
    return this.listeners.size > 0;
  }

  subscribe = (callback: () => void) => {
    clearTimeout(this.timer);
    this.listeners.add(callback);
    if (this.listeners.size === 1 && (!this.state.loaded || this.stale || this.state.error))
      void this.reload();
    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0) this.expireSoon();
    };
  };

  getSnapshot = () => this.state;

  private expireSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.live) this.client.drop(this);
    }, KEEP_MS);
  }

  private set(state: EntryState<T>) {
    this.state = state;
    for (const callback of this.listeners) callback();
  }

  /** 一覧にもう 1 ページ頼む。頼んだ時点で状態を替える（画面が LoadingMore を見て、届いたあとの CanLoadMore で次を頼める） */
  more(): Promise<void> {
    this.requestedPages++;
    this.set({ ...this.state });
    return this.reload();
  }

  markStale() {
    this.stale = true;
  }

  /** 読み直す。実行中なら終わってからもう 1 回（途中で書かれた分を取りこぼさない） */
  reload(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** 利用者が替わった。持っている値は別の人のものなので捨てて、生きていれば読み直す */
  reset() {
    this.generation++;
    this.text = undefined;
    this.reads = new Set();
    this.state = { value: undefined, loaded: false, error: undefined };
    if (this.live) {
      for (const callback of this.listeners) callback();
      void this.reload();
    } else this.stale = true;
  }

  private async loop() {
    do {
      this.again = false;
      this.stale = false;
      const generation = this.generation;
      try {
        const { value, reads } = await this.load(this);
        if (generation !== this.generation) {
          this.again = true;
          continue;
        }
        this.reads = new Set(reads);
        // 同じ結果なら通知しない（画面を無駄に描き直さない）
        const text = JSON.stringify(value) ?? "";
        if (this.state.loaded && !this.state.error && text === this.text) continue;
        this.text = text;
        this.remember?.(value);
        this.set({ value, loaded: true, error: undefined });
      } catch (error) {
        if (generation !== this.generation) {
          this.again = true;
          continue;
        }
        if (error instanceof ConvexError) {
          // 未サインインは「まだ読めていない」として扱う（サインアウト直後の描画で画面を落とさない）
          const data = error.data as { code?: unknown } | undefined;
          this.text = undefined;
          if (data?.code === "unauthenticated")
            this.set({ value: undefined, loaded: false, error: undefined });
          else this.set({ value: undefined, loaded: false, error });
        } else {
          // ponytail: 通信の失敗は黙って待つ。再接続（WebSocket の張り直し）か次の通知で読み直す。再試行の間隔は持たない
          console.warn("[cloudflare] 読み取りに失敗しました", this.key, error);
          this.stale = true;
        }
      }
    } while (this.again);
  }
}

export type { Entry };

export class CloudflareClient {
  readonly url: string;
  private session: Session | null = null;
  private auth: AuthState = { status: "loading", token: null };
  /** 利用者が替わるたびに増える。画面が保持している前の値を捨てる目印 */
  private epoch = 0;
  private readonly authListeners = new Set<() => void>();
  private readonly entries = new Map<string, Entry<any>>();
  private refreshing: Promise<boolean> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private socket: WebSocket | null = null;
  private socketTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  /** 起動時の `?code=` の交換と、保存済みトークンの更新が終わるまで */
  readonly ready: Promise<void>;

  constructor(url: string) {
    this.url = url.replace(/\/$/, "");
    // URL から消すのは同期で（ルーターが作られる前に。交換は非同期でよい）
    // verifier が無い code は、このタブが始めたサインインのものではない（横取り・貼り付け）ので採らない
    const code = takeCodeFromUrl();
    const verifier = code ? takeVerifier() : null;
    this.session = readStored();
    this.ready = this.start(code && verifier ? { code, verifier } : null);
    if (typeof window !== "undefined")
      // 別のタブが更新・サインイン・サインアウトしたら、こちらも追従する（refresh token は 1 回きりなので、2 つのタブで別々に更新できない）
      window.addEventListener("storage", (e) => {
        if (e.key !== STORAGE_KEY) return;
        this.setSession(readStored(), { persist: false });
      });
  }

  // --- 認証の状態 -------------------------------------------------------

  subscribeAuth = (callback: () => void) => {
    this.authListeners.add(callback);
    return () => {
      this.authListeners.delete(callback);
    };
  };
  getAuth = () => this.auth;
  getToken = () => this.auth.token;
  getEpoch = () => this.epoch;

  private async start(login: { code: string; verifier: string } | null) {
    try {
      if (login) await this.exchange(login.code, login.verifier);
      else if (this.session) {
        this.setSession(this.session, { persist: false });
        if (this.session.expiresAt - Date.now() < REFRESH_MARGIN_MS) await this.refresh();
      }
    } catch (error) {
      console.warn("[cloudflare] サインインを引き継げませんでした", error);
    } finally {
      if (this.auth.status === "loading") this.setSession(this.session, { persist: false });
    }
  }

  private setSession(next: Session | null, options: { persist: boolean }) {
    const previous = this.session;
    this.session = next;
    if (options.persist) writeStored(next);
    const status = next ? "authenticated" : "anonymous";
    if (this.auth.status !== status || this.auth.token !== (next?.access ?? null))
      this.auth = { status, token: next?.access ?? null };
    const userChanged =
      (previous ? jwtUser(previous.access) : null) !== (next ? jwtUser(next.access) : null);
    if (userChanged) {
      this.epoch++;
      optimistic.clear();
      for (const entry of this.entries.values()) entry.reset();
    }
    clearTimeout(this.refreshTimer);
    if (next)
      this.refreshTimer = setTimeout(
        () => void this.refresh(),
        Math.max(1000, next.expiresAt - REFRESH_MARGIN_MS - Date.now()),
      );
    this.syncSocket();
    for (const callback of this.authListeners) callback();
  }

  private adopt(tokens: { accessToken: string; refreshToken: string }) {
    this.setSession(
      {
        access: tokens.accessToken,
        refresh: tokens.refreshToken,
        expiresAt: expiryOf(tokens.accessToken),
      },
      { persist: true },
    );
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** 一時コード → access / refresh */
  private async exchange(code: string, verifier: string) {
    const res = await this.post("/auth/token", { code, verifier });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
    this.adopt((await res.json()) as { accessToken: string; refreshToken: string });
  }

  /**
   * サインインする。モック（`VITE_NOGIKU_MOCK=true`、または params に sub があるとき）は Worker の /auth/mock、
   * 本物は Nogiku へ遷移する（戻りの `?code=` は次の起動で拾う）。遷移するときは redirect を返す（画面は何もしない）
   */
  async signIn(params: Record<string, unknown>): Promise<{ signingIn: boolean; redirect?: URL }> {
    const mock = import.meta.env.VITE_NOGIKU_MOCK === "true" || typeof params.sub === "string";
    if (mock) {
      const profile: Record<string, unknown> = {};
      for (const key of ["sub", "name", "email", "hurigana"])
        if (typeof params[key] === "string" && params[key]) profile[key] = params[key];
      // 本物と同じ流れを 1 つのリクエストの中で回す（verifier は保存せずに使い切る）
      const { verifier, challenge } = await newPkce();
      const res = await this.post("/auth/mock", { ...profile, challenge });
      if (!res.ok) throw new Error(`mock sign-in failed: ${res.status}`);
      await this.exchange(((await res.json()) as { code: string }).code, verifier);
      return { signingIn: true };
    }
    const redirectTo =
      typeof params.redirectTo === "string" && params.redirectTo.startsWith("/")
        ? params.redirectTo
        : location.pathname + location.search;
    const { verifier, challenge } = await newPkce();
    // 戻ってきたとき、同じタブがこれを持っていなければ一時コードは採らない
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    const target = new URL(`${this.url}/auth/signin`);
    target.searchParams.set("redirectTo", redirectTo);
    target.searchParams.set("challenge", challenge);
    location.assign(target.href);
    return { signingIn: false, redirect: target };
  }

  async signOut() {
    const session = this.session;
    this.setSession(null, { persist: true });
    if (session)
      await this.post("/auth/signout", { refreshToken: session.refresh }).catch(() => undefined);
  }

  /**
   * refresh token で access を替える。refresh token は 1 回きりで替わるので、タブをまたいで 1 本に直列化し
   * （Web Locks）、ロックの中で「ほかのタブがもう替えた」かを保存から確かめる。
   * `rejected` は 401 で拒まれた access（保存のほうが新しければそれを使う）。
   * refresh token 自体が拒まれたらサインアウトの状態にする。通信の失敗では残す
   */
  refresh(rejected?: string): Promise<boolean> {
    this.refreshing ??= (async () => {
      const run = async (): Promise<boolean> => {
        const stored = readStored();
        const bad = rejected ?? this.session?.access;
        if (stored && stored.access !== bad && stored.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
          this.setSession(stored, { persist: false });
          return true;
        }
        const current = stored ?? this.session;
        if (!current) return false;
        try {
          const res = await this.post("/auth/refresh", { refreshToken: current.refresh });
          if (res.ok) {
            this.adopt((await res.json()) as { accessToken: string; refreshToken: string });
            return true;
          }
          if (res.status === 401) this.setSession(null, { persist: true });
        } catch {
          // 通信の失敗。サインインは残し、次の呼び出しでまた試す
        }
        return false;
      };
      try {
        return await (typeof navigator !== "undefined" && navigator.locks
          ? navigator.locks.request(LOCK_NAME, run)
          : run());
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** 期限が近ければ更新してから、いまの access を返す */
  private async freshToken(): Promise<string | null> {
    await this.ready;
    if (this.session && this.session.expiresAt - Date.now() < REFRESH_MARGIN_MS)
      await this.refresh();
    return this.session?.access ?? null;
  }

  // --- 呼び出し ---------------------------------------------------------

  /** `POST /f/<name>`。401 は更新して 1 回だけやり直す。失敗は ConvexError({ code, details }) */
  async call(
    name: string,
    args: unknown,
    retry = true,
  ): Promise<{ value: unknown; reads?: string[] }> {
    const token = await this.freshToken();
    const res = await fetch(`${this.url}/f/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(args ?? {}),
    });
    if (res.status === 401 && token && retry && (await this.refresh(token)))
      return this.call(name, args, false);
    const body = (await res.json().catch(() => null)) as {
      value?: unknown;
      reads?: string[];
      code?: string;
      details?: unknown;
    } | null;
    if (!res.ok)
      throw new ConvexError({
        code: body?.code ?? `http_${res.status}`,
        details: (body?.details ?? {}) as Value,
      });
    return { value: body?.value ?? null, ...(body?.reads ? { reads: body.reads } : {}) };
  }

  async query(ref: QueryRef | FunctionReference<"query", "internal">, args: unknown) {
    return (await this.call(getFunctionName(ref), args)).value;
  }
  async mutation(ref: FunctionReference<"mutation">, args: unknown) {
    return (await this.call(getFunctionName(ref), args)).value;
  }
  async action(ref: FunctionReference<"action">, args: unknown) {
    return (await this.call(getFunctionName(ref), args)).value;
  }

  // --- 購読 -------------------------------------------------------------

  /** 同じ問い合わせは 1 つの Entry を共有する */
  private entry<T>(key: string, make: () => Entry<T>): Entry<T> {
    let entry = this.entries.get(key) as Entry<T> | undefined;
    if (!entry) {
      entry = make();
      this.entries.set(key, entry);
    }
    return entry;
  }

  queryEntry(ref: QueryRef, args: Args): Entry {
    const name = getFunctionName(ref);
    // optimisticQueries の keyOf と同じ形にして、楽観的更新の読み取りと突き合わせる
    const key = `${name}|${JSON.stringify(args)}`;
    return this.entry(
      key,
      () =>
        new Entry(
          this,
          key,
          async () => {
            const { value, reads } = await this.call(name, args);
            return { value, reads: reads ?? [] };
          },
          (value) => optimistic.remember(ref, args, value),
        ),
    );
  }

  /** `paginationOpts` の cursor を、いま要る分のページ数だけ回して 1 つの結果にする */
  pagedEntry(ref: QueryRef, args: Record<string, unknown>, numItems: number) {
    const name = getFunctionName(ref);
    const key = `paged|${name}|${JSON.stringify(args)}|${numItems}`;
    type Paged = { results: unknown[]; done: boolean; pages: number };
    return this.entry<Paged>(
      key,
      () =>
        new Entry<Paged>(this, key, async (entry) => {
          const results: unknown[] = [];
          const reads = new Set<string>();
          let cursor: string | null = null;
          let done = false;
          let pages = 0;
          while (pages < entry.requestedPages && !done) {
            const res = await this.call(name, { ...args, paginationOpts: { numItems, cursor } });
            const page = res.value as { page: unknown[]; continueCursor: string; isDone: boolean };
            results.push(...page.page);
            for (const table of res.reads ?? []) reads.add(table);
            cursor = page.continueCursor;
            done = page.isDone;
            pages++;
          }
          return { value: { results, done, pages }, reads };
        }),
    );
  }

  /** 使われなくなって時間が経った Entry を捨てる */
  drop(entry: Entry<any>) {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
  }

  /** 楽観的更新で見えている値が土台と違う query だけ、サーバーの値に読み直す（巻き戻す前に済ませて、ちらつかせない） */
  async settleOptimistic() {
    const pending: Promise<void>[] = [];
    for (const base of optimistic.entries()) {
      const name = getFunctionName(base.ref as QueryRef);
      const entry = this.entries.get(`${name}|${JSON.stringify(base.args)}`);
      if (entry && optimistic.read(base.ref, base.args) !== entry.state.value)
        pending.push(entry.reload());
    }
    await Promise.all(pending);
  }

  // --- WebSocket --------------------------------------------------------

  private syncSocket() {
    if (this.auth.status === "authenticated") {
      if (!this.socket && !this.socketTimer) void this.connect();
    } else {
      clearTimeout(this.socketTimer);
      this.socketTimer = undefined;
      this.attempt = 0;
      const socket = this.socket;
      this.socket = null;
      socket?.close();
    }
  }

  private async connect() {
    const token = await this.freshToken();
    if (!token || this.socket || typeof WebSocket === "undefined") return;
    const socket = new WebSocket(
      `${this.url.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token)}`,
    );
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      // 切れている間の変更は届いていないので、生きている query を全部読み直す
      this.reloadLive();
    };
    socket.onmessage = (event) => {
      try {
        const { changed } = JSON.parse(String(event.data)) as { changed?: unknown };
        if (Array.isArray(changed))
          this.changed(changed.filter((t): t is string => typeof t === "string"));
      } catch {
        // 知らない形のメッセージは読み捨てる
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.auth.status !== "authenticated") return;
      // 指数バックオフ（0.5 秒から 30 秒。揃って再接続しないよう半分は揺らす）
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++) * (0.5 + Math.random() / 2);
      this.socketTimer = setTimeout(() => {
        this.socketTimer = undefined;
        if (this.auth.status === "authenticated") void this.connect();
      }, delay);
    };
  }

  private reloadLive() {
    for (const entry of this.entries.values()) {
      if (entry.live) void entry.reload();
      else entry.markStale();
    }
  }

  /**
   * 書かれた表の名前が来た。読んだ表が交わる Entry だけ読み直す（ponytail: 粒度は表。行や列では絞らない）。
   * まだ最初の読み取りが終わっていないもの（reads が分からない）は、念のため読み直す
   */
  private changed(tables: string[]) {
    for (const entry of this.entries.values()) {
      const hit = !entry.state.loaded || tables.some((t) => entry.reads.has(t));
      if (!hit) continue;
      if (entry.live) void entry.reload();
      else entry.markStale();
    }
  }
}

export const cloudflare = new CloudflareClient(
  (import.meta.env.VITE_CLOUDFLARE_URL as string | undefined) ?? "http://localhost:8790",
);
