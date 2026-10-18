import { describe, expect, it } from "vite-plus/test";
import {
  ArtifactError,
  ArtifactFiles,
  type ArtifactPersistence,
  type ArtifactRequest,
  type ArtifactResponse,
  type ArtifactTransport,
} from "./artifactFiles";
import { defaultFileCachePolicy } from "./fileCachePolicy";
import { jwtUser } from "./jwt";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

/** 本番の Worker と同じ振る舞い（Range / ETag / 304 / 認可）をする偽の通信。1 回の呼び出しを calls に残す */
class FakeTransport implements ArtifactTransport {
  readonly calls: ArtifactRequest[] = [];
  files = new Map<string, Uint8Array>();
  /** 見られる利用者のトークン。null なら誰でも */
  allowed: Set<string> | null = null;
  chunkSize = 1000;
  /** 本体の途中で切断する（1 回だけ） */
  breakAfter: number | null = null;
  rangeSupported = true;
  /** 本体の送出を止めて合図があるまで待たせる */
  gate: Promise<void> | null = null;

  async request(req: ArtifactRequest): Promise<ArtifactResponse> {
    this.calls.push(req);
    const data = this.files.get(req.artifactId);
    if (!data || (this.allowed && !this.allowed.has(req.token))) throw new ArtifactError(403);
    const etag = `"e-${req.artifactId}-${data.length}"`;
    if (req.ifNoneMatch === etag)
      return {
        status: 304,
        etag,
        contentType: "application/pdf",
        total: data.length,
        start: 0,
        rangeSupported: true,
        body: null,
      };
    const ranged =
      this.rangeSupported && req.start !== undefined && (!req.ifRange || req.ifRange === etag);
    const from = ranged ? req.start! : 0;
    const to = ranged && req.end !== undefined ? Math.min(req.end + 1, data.length) : data.length;
    let offset = from;
    let sent = 0;
    const breakAfter = this.breakAfter;
    const gate = this.gate;
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (gate) await gate;
        if (offset >= to) return controller.close();
        if (breakAfter !== null && sent >= breakAfter) {
          this.breakAfter = null;
          return controller.error(new TypeError("network"));
        }
        const next = Math.min(offset + this.chunkSize, to);
        controller.enqueue(data.slice(offset, next));
        sent += next - offset;
        offset = next;
      },
    });
    return {
      status: ranged ? 206 : 200,
      etag,
      contentType: "application/pdf",
      total: data.length,
      start: from,
      rangeSupported: this.rangeSupported,
      body,
    };
  }
}

class FakePersistence implements ArtifactPersistence {
  readonly store = new Map<string, { blob: Blob; etag: string | null }>();
  async get(subject: string, id: string) {
    return this.store.get(`${subject}/${id}`) ?? null;
  }
  async put(subject: string, id: string, blob: Blob, etag: string | null) {
    this.store.set(`${subject}/${id}`, { blob, etag });
  }
  async delete(subject: string, id: string) {
    this.store.delete(`${subject}/${id}`);
  }
  async clear(keep?: string) {
    for (const k of [...this.store.keys()])
      if (keep === undefined || !k.startsWith(`${keep}/`)) this.store.delete(k);
  }
}

function setup() {
  const transport = new FakeTransport();
  transport.files.set("a1", bytes(5000));
  transport.files.set("big", bytes(1_000_000));
  const persistence = new FakePersistence();
  const files = new ArtifactFiles({
    transport,
    persistence,
    subjectOf: (t) => t.split(":")[0]!,
    policy: defaultFileCachePolicy,
    retryDelayMs: 0,
  });
  return { transport, persistence, files };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("同じ添付の二重取得をしない", () => {
  it("同時に何か所から頼まれても通信は 1 回で、同じ中身を返す", async () => {
    const { files, transport } = setup();
    const [a, b, c] = await Promise.all([
      files.blob("u1:t1", "a1"),
      files.blob("u1:t1", "a1"),
      files.blob("u1:t1", "a1"),
    ]);
    expect(transport.calls).toHaveLength(1);
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(bytes(5000));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("トークンが更新されても（同じ利用者なら）取り直さない", async () => {
    const { files, transport } = setup();
    await files.blob("u1:old", "a1");
    await files.blob("u1:new", "a1");
    expect(transport.calls).toHaveLength(1);
  });

  it("取得済みはメモリから返す（通信しない）", async () => {
    const { files, transport } = setup();
    await files.blob("u1:t", "a1");
    transport.calls.length = 0;
    await files.blob("u1:t", "a1");
    expect(transport.calls).toHaveLength(0);
  });

  it("失敗は覚えず、次に頼まれたら取り直す", async () => {
    const { files, transport } = setup();
    transport.allowed = new Set();
    await expect(files.blob("u1:t", "a1")).rejects.toMatchObject({ status: 403 });
    transport.allowed = null;
    expect((await files.blob("u1:t", "a1")).size).toBe(5000);
  });

  it("別の利用者とは共有しない", async () => {
    const { files, transport } = setup();
    await files.blob("u1:t", "a1");
    await files.blob("u2:t", "a1");
    expect(transport.calls).toHaveLength(2);
  });
});

describe("端末の写し", () => {
  it("取得後に残し、次回（メモリが空でも）は通信せず開き、裏で条件付きに確かめる（304）", async () => {
    const { files, transport, persistence } = setup();
    await files.blob("u1:t", "a1", { persist: true });
    await flush();
    expect(persistence.store.size).toBe(1);
    files.dropMemory();
    transport.calls.length = 0;
    const dl = files.open("u1:t", "a1", { persist: true });
    const blob = await dl.blob;
    expect(dl.fromCache).toBe(true);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes(5000));
    await flush();
    // 本体は取らず、検証子つきの確認が 1 回だけ
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]!.ifNoneMatch).toBe(`"e-a1-5000"`);
  });

  it("persist を指定しない（機密など）なら端末に残さない", async () => {
    const { files, persistence } = setup();
    await files.blob("u1:t", "a1");
    await flush();
    expect(persistence.store.size).toBe(0);
  });

  it("写しから開いたあと権限が無いと分かれば、写しを捨てて知らせる", async () => {
    const { files, transport, persistence } = setup();
    await files.blob("u1:t", "a1", { persist: true });
    await flush();
    files.dropMemory();
    const revoked: string[] = [];
    files.onRevoked((id) => revoked.push(id));
    transport.allowed = new Set(); // 剥奪された
    await files.open("u1:t", "a1", { persist: true }).blob;
    await flush();
    expect(revoked).toEqual(["a1"]);
    expect(persistence.store.size).toBe(0);
  });

  it("サインアウトで全員分、別の利用者のサインインでその人以外の分を消す", async () => {
    const { files, persistence } = setup();
    await files.blob("u1:t", "a1", { persist: true });
    await files.blob("u2:t", "a1", { persist: true });
    await flush();
    expect(persistence.store.size).toBe(2);
    await files.clear("u2");
    expect([...persistence.store.keys()]).toEqual(["u2/a1"]);
    await files.clear();
    expect(persistence.store.size).toBe(0);
  });
});

describe("受け取りながら使う（PDF の逐次読み込み）", () => {
  it("全部届く前から届いた分を渡し、続きを購読でき、完了を知らせる", async () => {
    const { files, transport } = setup();
    let release!: () => void;
    transport.gate = new Promise((r) => (release = r));
    // 最初の数チャンクだけ先に流す
    const dl = files.open("u1:t", "a1");
    await dl.ready;
    expect(dl.total).toBe(5000);
    expect(dl.rangeSupported).toBe(true);
    transport.gate = null;
    release();
    await dl.firstBytes();
    const got: number[] = [];
    let ended = false;
    const sub = dl.subscribe({ chunk: (c) => got.push(c.byteLength), end: () => (ended = true) });
    const initial = sub ? sub.initial.reduce((n, c) => n + c.byteLength, 0) : 5000;
    await dl.blob;
    const total = initial + got.reduce((n, x) => n + x, 0);
    expect(total).toBe(5000);
    if (sub) expect(ended).toBe(true);
  });

  it("離れた範囲は、受け取り済みでなければ別の範囲取得で取る", async () => {
    const { files, transport } = setup();
    let release!: () => void;
    transport.gate = new Promise((r) => (release = r));
    const dl = files.open("u1:t", "big");
    await dl.ready;
    // 本体の送出が止まっているあいだに、ファイルの終わりを要求する（pdf.js が索引を探す場面）
    transport.gate = null;
    const tail = await dl.readRange(990_000, 1_000_000);
    expect(tail).toEqual(bytes(1_000_000).slice(990_000, 1_000_000));
    const ranged = transport.calls.filter((c) => c.start === 990_000);
    expect(ranged).toHaveLength(1);
    expect(ranged[0]!.end).toBe(999_999);
    release();
    await dl.blob;
  });

  it("受け取りの続きがすぐ届く範囲は、別に取らず続きを待つ（同じバイトを二重に運ばない）", async () => {
    const { files, transport } = setup();
    const dl = files.open("u1:t", "a1"); // 5000 バイト。先頭からの距離が近い
    const part = await dl.readRange(4000, 5000);
    expect(part).toEqual(bytes(5000).slice(4000, 5000));
    await dl.blob;
    expect(transport.calls).toHaveLength(1); // 本体の 1 本だけ
  });

  it("受け取り済みの範囲は通信せずに返す", async () => {
    const { files, transport } = setup();
    const dl = files.open("u1:t", "a1");
    await dl.blob;
    transport.calls.length = 0;
    expect(await dl.readRange(10, 20)).toEqual(bytes(5000).slice(10, 20));
    expect(transport.calls).toHaveLength(0);
  });

  it("範囲取得に応じないサーバーでは全体を待って切り出す", async () => {
    const { files, transport } = setup();
    transport.rangeSupported = false;
    const dl = files.open("u1:t", "a1");
    await dl.ready;
    expect(dl.rangeSupported).toBe(false);
    expect(await dl.readRange(4000, 4010)).toEqual(bytes(5000).slice(4000, 4010));
    expect(transport.calls).toHaveLength(1);
  });

  it("途中で切れたら、受け取った続きから取り直して完走する", async () => {
    const { files, transport } = setup();
    transport.breakAfter = 2500;
    const blob = await files.blob("u1:t", "a1");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes(5000));
    const resume = transport.calls[1]!;
    expect(resume.start).toBe(3000); // 1000 バイトずつの 3 個目まで受け取り済み
    expect(resume.ifRange).toBe(`"e-a1-5000"`);
  });

  it("権限の無い取得は再試行せず失敗する", async () => {
    const { files, transport } = setup();
    transport.allowed = new Set();
    await expect(files.blob("u1:t", "a1")).rejects.toMatchObject({ status: 403 });
    expect(transport.calls).toHaveLength(1);
  });
});

describe("jwtUser", () => {
  const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=/g, "")}.s`;
  it("sub のうち利用者 ID の部分だけを返す（セッションが替わっても同じ）", () => {
    expect(jwtUser(jwt("user123|sessionA"))).toBe("user123");
    expect(jwtUser(jwt("user123|sessionB"))).toBe("user123");
  });
  it("読めないトークンはトークン全体（別の利用者と混ざらない側）", () => {
    expect(jwtUser("garbage")).toBe("garbage");
  });
});
