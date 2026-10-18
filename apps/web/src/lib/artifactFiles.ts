/**
 * 添付ファイル（版の PDF・画像・動画・文章）の取得と手元の写し。docs/UI_M3E.md §77
 *
 * 目的: 「ファイルの読み込みが遅い」への対処。次の 4 つを 1 か所で受け持つ。
 * 1. 同じファイルの二重取得をなくす: 利用者＋添付 ID ごとに取得を 1 本にし、進行中の取得を共有する
 *    （校正画面・自動校正・版比較・ダウンロードが同じファイルを同時に欲しがっても、通信は 1 回）。
 *    添付は ID ごとに中身が変わらない（版の提出で新しい ID になる）ので、同じ ID の写しは使い回してよい。
 * 2. 受け取りながら使えるようにする: 本体はストリームで受け、届いた分から PDF.js に渡せる（lib の呼び手は
 *    `subscribe` / `readRange`）。ファイルを全部受け取ってから描画を始めない。
 * 3. 手元に残す（端末の Cache Storage。利用者ごと・サインアウトで消す。残す条件は fileCachePolicy）。
 *    2 回目以降は通信せず即座に開く。
 * 4. 写しから開いたときも、Worker への条件付き取得（If-None-Match）で「今も見られるか」を裏で確かめる。
 *    見られなくなっていれば写しを捨てて、画面に知らせる（A-11: 権限剥奪が効く）。Worker は毎回認可を通してから 304 を返す。
 *
 * 通信そのものは `ArtifactTransport`（本番は fetch、デモは Blob からの擬似）に切り出してあり、ここは環境を知らない。
 */

import type { FileCachePolicy } from "./fileCachePolicy";

/** 通信の失敗（status は HTTP の状態。0 は通信できなかった） */
export class ArtifactError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(
      message ??
        (status === 403 || status === 401 || status === 404
          ? "このファイルを閲覧する権限がありません"
          : "ファイルを読み込めませんでした。もう一度お試しください。"),
    );
    this.name = "ArtifactError";
  }
  /** 権限が無い（または無くなった）ことを示す失敗 */
  get denied(): boolean {
    return this.status === 401 || this.status === 403 || this.status === 404;
  }
}

export interface ArtifactRequest {
  token: string;
  artifactId: string;
  /** 範囲取得（両端を含む）。end 省略は末尾まで */
  start?: number;
  end?: number;
  /** 手元の写しの検証子。一致すれば 304（本体なし） */
  ifNoneMatch?: string;
  /** この検証子と今の実体が同じときだけ範囲を返す。違えば全体 */
  ifRange?: string;
  signal?: AbortSignal;
}

export interface ArtifactResponse {
  /** 200 全体・206 範囲・304 変更なし */
  status: 200 | 206 | 304;
  etag: string | null;
  contentType: string | null;
  /** 実体全体の大きさ。分からなければ null */
  total: number | null;
  /** body の先頭が実体の何バイト目か（206 のとき範囲の始め、200 は 0） */
  start: number;
  /** サーバーが範囲取得に応じるか（Accept-Ranges: bytes） */
  rangeSupported: boolean;
  body: ReadableStream<Uint8Array> | null;
}

export interface ArtifactTransport {
  /** 200・206・304 以外は ArtifactError を投げる */
  request(req: ArtifactRequest): Promise<ArtifactResponse>;
}

/** 手元の写しの置き場（本番は Cache Storage）。失敗は握りつぶしてよい（写しが無いだけ） */
export interface ArtifactPersistence {
  get(subject: string, artifactId: string): Promise<{ blob: Blob; etag: string | null } | null>;
  put(subject: string, artifactId: string, blob: Blob, etag: string | null): Promise<void>;
  delete(subject: string, artifactId: string): Promise<void>;
  /** keepSubject 以外の利用者の写しをすべて消す。省略なら全員分 */
  clear(keepSubject?: string): Promise<void>;
}

export interface ArtifactFilesOptions {
  transport: ArtifactTransport;
  /** null なら端末には残さない（メモリだけ） */
  persistence: ArtifactPersistence | null;
  /** トークンからこの利用者を表す文字列（写しの持ち主） */
  subjectOf: (token: string) => string;
  policy: FileCachePolicy;
  /** 取得の再試行までの待ち（テストで 0 にする） */
  retryDelayMs?: number;
}

/** 受け取りの購読。end は全部届いた（err 無し）か、失敗・中止（err あり） */
export interface ChunkListener {
  chunk(chunk: Uint8Array): void;
  end(err?: unknown): void;
}

export interface OpenOptions {
  /** 端末に残してよいか（機密区分の扱いは fileCachePolicy。呼び手は制作物の区分で決める） */
  persist?: boolean;
}

const MAX_RESUMES = 3;

export class ArtifactDownload {
  /** 受け取った分（先頭から順。全部届いたら捨てて whole に切り替える） */
  private chunks: Uint8Array[] = [];
  private whole: Blob | null = null;
  received = 0;
  total: number | null = null;
  etag: string | null = null;
  contentType: string | null = null;
  rangeSupported = false;
  fromCache = false;
  private persistWanted: boolean;
  private persisted = false;
  private error: unknown = null;
  private listeners = new Set<{ index: number; fn: ChunkListener }>();
  private waiters = new Set<() => void>();
  private controller = new AbortController();
  private done = false;
  /** 最初の応答までの時間と、本体の受け取りの速さ（離れた範囲を別に取るか、続きの到着を待つかの見積もり） */
  private ttfbMs = 0;
  private firstByteAt = 0;
  /** 全部届いたら解決（失敗で拒否） */
  readonly blob: Promise<Blob>;
  private resolveBlob!: (b: Blob) => void;
  private rejectBlob!: (e: unknown) => void;
  /** 最初の応答（大きさ・検証子）が届くか、写しが見つかったら解決 */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: unknown) => void;

  constructor(
    readonly artifactId: string,
    readonly subject: string,
    private readonly owner: ArtifactFiles,
    persist: boolean,
  ) {
    this.persistWanted = persist;
    this.blob = new Promise((res, rej) => {
      this.resolveBlob = res;
      this.rejectBlob = rej;
    });
    this.ready = new Promise((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });
    // 誰も待っていなくても未処理の拒否にしない（待つ側が個別に拾う）
    this.blob.catch(() => undefined);
    this.ready.catch(() => undefined);
  }

  get complete(): boolean {
    return this.done && this.whole !== null;
  }
  get size(): number {
    return this.whole?.size ?? this.received;
  }
  get failed(): boolean {
    return this.error !== null;
  }

  /** 全部が手元にあれば、その Blob（無ければ null） */
  get completed(): Blob | null {
    return this.whole;
  }

  /** @internal ArtifactFiles から呼ぶ */
  async start(token: string): Promise<void> {
    try {
      const hit = await this.owner.readPersisted(this);
      if (hit) {
        this.fromCache = true;
        this.etag = hit.etag;
        this.total = hit.blob.size;
        this.contentType = hit.blob.type || null;
        this.persisted = true;
        this.finish(hit.blob);
        this.resolveReady();
        this.owner.revalidate(this, token);
        return;
      }
      await this.pump(token);
    } catch (e) {
      this.fail(e);
    }
  }

  private async pump(token: string): Promise<void> {
    let resumes = 0;
    let first = true;
    for (;;) {
      try {
        const requestedAt = performance.now();
        const res = await this.owner.transport.request({
          token: this.owner.currentToken(token),
          artifactId: this.artifactId,
          ...(this.received > 0
            ? { start: this.received, ...(this.etag ? { ifRange: this.etag } : {}) }
            : {}),
          signal: this.controller.signal,
        });
        if (first) {
          first = false;
          this.ttfbMs = performance.now() - requestedAt;
          this.etag = res.etag;
          this.contentType = res.contentType;
          this.total = res.total;
          this.rangeSupported = res.rangeSupported;
          this.resolveReady();
        } else if (res.status !== 206 || res.start !== this.received || res.etag !== this.etag) {
          // 再開の応答が噛み合わない（途中で実体が替わった・範囲を無視した）: 続けられない
          await res.body?.cancel().catch(() => undefined);
          throw new ArtifactError(0);
        }
        if (!res.body) throw new ArtifactError(0);
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) this.push(value);
        }
        if (this.total !== null && this.received !== this.total) throw new ArtifactError(0);
        this.finish(new Blob(this.chunks as BlobPart[], { type: this.contentType ?? "" }));
        return;
      } catch (e) {
        if (this.controller.signal.aborted) throw e;
        if (e instanceof ArtifactError && e.status !== 0) throw e; // 権限・存在・サーバーの拒否は再試行しない
        // 通信が途中で切れた: 受け取った続きから取り直す（範囲取得に応じるサーバーのみ）
        if (!this.rangeSupported || this.received === 0 || ++resumes > MAX_RESUMES)
          throw e instanceof ArtifactError ? e : new ArtifactError(0);
        await new Promise((r) => setTimeout(r, this.owner.retryDelayMs * resumes));
      }
    }
  }

  private push(chunk: Uint8Array) {
    if (this.firstByteAt === 0) this.firstByteAt = performance.now();
    this.chunks.push(chunk);
    this.received += chunk.byteLength;
    for (const l of this.listeners) {
      // 追いつかせる（購読した時点より前の分は購読時に渡し済み）
      while (l.index < this.chunks.length) l.fn.chunk(this.chunks[l.index++]!);
    }
    this.wake();
  }

  private finish(blob: Blob) {
    this.whole = blob;
    this.done = true;
    this.chunks = [];
    for (const l of [...this.listeners]) l.fn.end();
    this.listeners.clear();
    this.wake();
    this.resolveBlob(blob);
    this.owner.completed(this);
    this.maybePersist();
  }

  private fail(e: unknown) {
    if (this.error) return;
    this.error = e;
    this.done = true;
    this.chunks = [];
    for (const l of [...this.listeners]) l.fn.end(e);
    this.listeners.clear();
    this.rejectReady(e);
    this.rejectBlob(e);
    this.wake();
    this.owner.forget(this);
  }

  private wake() {
    const ws = [...this.waiters];
    this.waiters.clear();
    for (const w of ws) w();
  }

  /** 写しを端末に残す（条件が整っていれば。同じ添付は 1 回だけ） */
  maybePersist() {
    if (this.persistWanted && !this.persisted && this.whole) {
      this.persisted = true;
      void this.owner.persist(this, this.whole);
    }
  }

  allowPersist() {
    this.persistWanted = true;
    this.maybePersist();
  }

  /** 取得を止める（サインアウト・利用者の切り替え） */
  abort() {
    this.controller.abort();
    this.fail(new ArtifactError(0, "取得を中止しました"));
  }

  private nearBytes(): number {
    const elapsed = performance.now() - this.firstByteAt;
    const rate = this.firstByteAt > 0 && elapsed > 200 ? this.received / (elapsed / 1000) : 0;
    return Math.max(MIN_NEAR_BYTES, rate * ((this.ttfbMs * 2) / 1000));
  }

  /** 先頭から 1 バイトでも届く（または全部届く・失敗する）まで待つ */
  async firstBytes(): Promise<void> {
    await this.ready;
    while (this.received === 0 && !this.done) await new Promise<void>((r) => this.waiters.add(r));
    if (this.error) throw this.error;
  }

  /**
   * 届いている分をすべて返し（先頭から順）、以降に届く分を fn に渡す。完了・失敗は fn.end で知らせる。
   * 全部届いている（whole がある）ときは null を返す（呼び手は blob から読む）。同じ tick の中で呼ぶこと
   */
  subscribe(fn: ChunkListener): { initial: Uint8Array[]; stop: () => void } | null {
    if (this.whole || this.error) return null;
    const entry = { index: this.chunks.length, fn };
    this.listeners.add(entry);
    return { initial: [...this.chunks], stop: () => this.listeners.delete(entry) };
  }

  /**
   * [begin, end) のバイト列。受け取り済みならそこから、受け取りの続きがすぐ届く範囲なら続きを待ち、
   * 離れていれば範囲取得で別に取る（PDF.js がファイルの終わりの索引などへ飛ぶとき。逐次の受け取りは止めない）。
   * 別に取るのは同時に MAX_RANGE_REQUESTS 本まで（待ちは後から来たものを先に）。PDF.js は平らなページ木だと全ページの定義を一斉に要求するが、
   * 順番を待つあいだに受け取りが追いつけば、通信せずにそこから返す
   */
  async readRange(begin: number, end: number): Promise<Uint8Array> {
    let release: (() => void) | null = null;
    try {
      for (;;) {
        if (this.whole) return new Uint8Array(await this.whole.slice(begin, end).arrayBuffer());
        if (this.error) throw this.error;
        const to = this.total === null ? end : Math.min(end, this.total);
        if (this.received >= to) return concat(this.chunks).slice(begin, to);
        if (!this.rangeSupported) {
          await this.blob;
          continue;
        }
        // 往復 2 回分の間に届く量の手前なら、別に取らず続きを待つ。別に取ると同じバイトを二重に運び、
        // 本体の受け取りと帯域を取り合って、かえって遅くなる
        if (begin - this.received <= this.nearBytes()) {
          while (this.received < to && !this.done)
            await new Promise<void>((r) => this.waiters.add(r));
          continue;
        }
        if (!release) {
          release = await this.acquireRangeSlot();
          continue; // 順番を待つあいだに受け取りが追いついたかもしれない
        }
        return await this.fetchRange(begin, to);
      }
    } finally {
      release?.();
    }
  }

  private activeRanges = 0;
  private rangeQueue: Array<() => void> = [];
  private async acquireRangeSlot(): Promise<() => void> {
    if (this.activeRanges >= MAX_RANGE_REQUESTS)
      await new Promise<void>((r) => this.rangeQueue.push(r));
    else this.activeRanges++;
    return () => {
      // 後から来た要求を先に通す（PDF.js が全ページの定義を一斉に頼んだあとで見つかる、いま描くのに要る範囲を待たせない）
      const next = this.rangeQueue.pop();
      if (next) next();
      else this.activeRanges--;
    };
  }

  private async fetchRange(begin: number, to: number): Promise<Uint8Array> {
    const res = await this.owner.transport.request({
      token: this.owner.currentToken(""),
      artifactId: this.artifactId,
      start: begin,
      end: to - 1,
      ...(this.etag ? { ifRange: this.etag } : {}),
      signal: this.controller.signal,
    });
    if (res.status === 206 && res.start === begin && res.body)
      return new Uint8Array(await new Response(res.body).arrayBuffer());
    // 範囲を無視して全体を返された: 全体を待って切り出す
    await res.body?.cancel().catch(() => undefined);
    const whole = await this.blob;
    return new Uint8Array(await whole.slice(begin, to).arrayBuffer());
  }
}

/** 別に取る範囲取得の同時本数 */
const MAX_RANGE_REQUESTS = 4;

/** 続きを待つか別に取るかの境目（バイト）。往復 2 回分に受け取れる量、ただし最低 256KB */
const MIN_NEAR_BYTES = 256 * 1024;
export { MIN_NEAR_BYTES };

function concat(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.byteLength;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export class ArtifactFiles {
  readonly transport: ArtifactTransport;
  readonly retryDelayMs: number;
  private readonly persistence: ArtifactPersistence | null;
  private readonly subjectOf: (token: string) => string;
  private readonly policy: FileCachePolicy;
  private readonly entries = new Map<string, ArtifactDownload>();
  private readonly revokedListeners = new Set<(artifactId: string) => void>();
  private tokenProvider: (() => string | null) | null = null;

  constructor(opts: ArtifactFilesOptions) {
    this.transport = opts.transport;
    this.persistence = opts.persistence;
    this.subjectOf = opts.subjectOf;
    this.policy = opts.policy;
    this.retryDelayMs = opts.retryDelayMs ?? 400;
  }

  /** 最新のトークンを返す関数を登録する（トークンは更新される。取得のたびに最新を使う） */
  setTokenProvider(fn: (() => string | null) | null) {
    this.tokenProvider = fn;
  }
  currentToken(fallback: string): string {
    return this.tokenProvider?.() ?? fallback;
  }

  private key(subject: string, id: string) {
    return `${subject}\u0000${id}`;
  }

  /** この添付の取得を（無ければ始めて）返す。進行中・取得済みのものは共有する */
  open(token: string, artifactId: string, opts: OpenOptions = {}): ArtifactDownload {
    const subject = this.subjectOf(token);
    const key = this.key(subject, artifactId);
    const persist = Boolean(opts.persist) && this.policy.persist;
    let entry = this.entries.get(key);
    if (entry && !entry.failed) {
      // LRU: 使ったものを後ろへ
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (persist) entry.allowPersist();
      return entry;
    }
    entry = new ArtifactDownload(artifactId, subject, this, persist);
    this.entries.set(key, entry);
    void entry.start(token);
    return entry;
  }

  /** 全部を Blob で（既存の呼び手向け）。同じ添付の取得は共有される */
  async blob(token: string, artifactId: string, opts: OpenOptions = {}): Promise<Blob> {
    return this.open(token, artifactId, opts).blob;
  }

  /** 先に取りに行く（開く前から。結果は待たない） */
  prefetch(token: string, artifactId: string, opts: OpenOptions = {}) {
    void this.open(token, artifactId, opts).blob.catch(() => undefined);
  }

  /** 写しが見つかった / 見つからなかった（ArtifactDownload.start から） */
  async readPersisted(entry: ArtifactDownload) {
    if (!this.persistence || !this.policy.persist) return null;
    try {
      return await this.persistence.get(entry.subject, entry.artifactId);
    } catch {
      return null;
    }
  }

  async persist(entry: ArtifactDownload, blob: Blob) {
    if (!this.persistence || blob.size > this.policy.maxEntryBytes) return;
    try {
      await this.persistence.put(entry.subject, entry.artifactId, blob, entry.etag);
    } catch {
      // 容量不足など。残せなくても開くことには影響しない
    }
  }

  /** 取得が済んだ: メモリの上限を超えた古いものから手放す */
  completed(_entry: ArtifactDownload) {
    let total = 0;
    for (const e of this.entries.values()) if (e.complete) total += e.size;
    if (total <= this.policy.memoryBytes) return;
    for (const [key, e] of this.entries) {
      if (total <= this.policy.memoryBytes) break;
      if (!e.complete || e === _entry) continue;
      total -= e.size;
      this.entries.delete(key);
    }
  }

  forget(entry: ArtifactDownload) {
    const key = this.key(entry.subject, entry.artifactId);
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }

  /**
   * 写しから開いたとき、今も見られるかを Worker に確かめる（裏で）。Worker は認可を通してから 304 を返す。
   * 見られない（権限剥奪・削除）なら写しを捨て、購読者に知らせる
   */
  revalidate(entry: ArtifactDownload, token: string) {
    void (async () => {
      try {
        const res = await this.transport.request({
          token: this.currentToken(token),
          artifactId: entry.artifactId,
          ...(entry.etag ? { ifNoneMatch: entry.etag } : { start: 0, end: 0 }),
        });
        await res.body?.cancel().catch(() => undefined);
        // 304 以外（中身が替わった）は、写しを捨てて次に取り直す
        if (res.status === 200 && entry.etag && res.etag !== entry.etag) this.discard(entry);
      } catch (e) {
        if (e instanceof ArtifactError && e.denied) {
          this.discard(entry);
          for (const l of this.revokedListeners) l(entry.artifactId);
        }
      }
    })();
  }

  private discard(entry: ArtifactDownload) {
    this.forget(entry);
    void this.persistence?.delete(entry.subject, entry.artifactId).catch(() => undefined);
  }

  /** 写しが使えなくなった（権限剥奪など）ときの知らせ */
  onRevoked(fn: (artifactId: string) => void): () => void {
    this.revokedListeners.add(fn);
    return () => this.revokedListeners.delete(fn);
  }

  /**
   * サインアウト・利用者の切り替え: 取得を止め、メモリと端末の写しを捨てる。
   * keepSubject を渡すと、その利用者の分だけ残す（サインイン直後に前の利用者の分を片付ける）
   */
  async clear(keepSubject?: string): Promise<void> {
    for (const [key, e] of [...this.entries]) {
      if (keepSubject !== undefined && e.subject === keepSubject) continue;
      this.entries.delete(key);
      e.abort();
    }
    try {
      await this.persistence?.clear(keepSubject);
    } catch {
      // 消せなくても次のサインアウトで再度試す
    }
  }

  /** メモリの写しだけ捨てる（端末の写しは残す）。E2E が「端末の写しから開く」経路を確かめるのに使う */
  dropMemory(): void {
    this.entries.clear();
  }

  subjectFor(token: string): string {
    return this.subjectOf(token);
  }
}
