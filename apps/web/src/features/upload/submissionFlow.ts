/**
 * 版提出のオーケストレーション（U-04 / F-04 / A-02）。
 * 準備 → 各ファイルをハッシュ付きで転送 → 失敗ファイルの個別再送 → 確定、を UI 非依存の状態機械として実装し、単体テストする。
 * 旧版の受付は「確定」が成功するまで変わらない（サーバー側の保証。ここでは UI が誤って確定を促さないことを担保する）。
 */
import { describeError } from "../../lib/errors";

export type ItemStatus = "pending" | "uploading" | "verified" | "failed";

export interface FlowItem {
  itemId: string;
  fileName: string;
  file: File | null; // 外部リンクは null
  status: ItemStatus;
  progress: number;
  error: string | null;
}

export interface FlowState {
  sessionId: string | null;
  items: FlowItem[];
  confirming: boolean;
  confirmed: {
    revisionId: string;
    sequence: number;
    kind: string;
    supersededRevisionId: string | null;
  } | null;
  error: string | null;
}

export interface FlowDeps {
  prepare(): Promise<{
    sessionId: string;
    /** keyPrefix が null の項目は外部リンク（実体を送らない） */
    items: Array<{ id: string; fileName: string; keyPrefix: string | null }>;
  }>;
  upload(
    itemId: string,
    file: File,
    onProgress: (f: number) => void,
  ): Promise<{ status: string; failureMessage: string | null }>;
  reset(itemId: string): Promise<void>;
  confirm(
    sessionId: string,
    requestId: string,
  ): Promise<{
    revisionId: string;
    sequence: number;
    kind: string;
    supersededRevisionId: string | null;
  }>;
  randomId(): string;
}

export const initialState: FlowState = {
  sessionId: null,
  items: [],
  confirming: false,
  confirmed: null,
  error: null,
};

export function canConfirm(state: FlowState): boolean {
  return (
    state.sessionId !== null &&
    !state.confirming &&
    state.confirmed === null &&
    state.items.length > 0 &&
    state.items.every((i) => i.status === "verified")
  );
}

export function failedItems(state: FlowState): FlowItem[] {
  return state.items.filter((i) => i.status === "failed");
}

export class SubmissionFlow {
  state: FlowState = initialState;
  private readonly listeners = new Set<(s: FlowState) => void>();
  private confirmRequestId: string | null = null;

  constructor(
    private readonly deps: FlowDeps,
    private readonly files: File[],
  ) {}

  subscribe(fn: (s: FlowState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<FlowState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private patchItem(itemId: string, patch: Partial<FlowItem>) {
    this.set({
      items: this.state.items.map((i) => (i.itemId === itemId ? { ...i, ...patch } : i)),
    });
  }

  /** 準備（セッション作成）と全ファイルの転送。失敗しても他のファイルは続行し、どれが失敗したか分かる状態で止まる。 */
  async start(): Promise<void> {
    this.set({ error: null });
    const prepared = await this.deps.prepare();
    const items: FlowItem[] = prepared.items.map((it, index) => ({
      itemId: it.id,
      fileName: it.fileName,
      file: it.keyPrefix === null ? null : (this.files[index] ?? null),
      status: it.keyPrefix === null ? "verified" : "pending",
      progress: it.keyPrefix === null ? 1 : 0,
      error: null,
    }));
    this.set({ sessionId: prepared.sessionId, items });
    await Promise.all(items.filter((i) => i.file !== null).map((i) => this.uploadOne(i.itemId)));
  }

  private async uploadOne(itemId: string): Promise<void> {
    const item = this.state.items.find((i) => i.itemId === itemId);
    if (!item?.file) return;
    this.patchItem(itemId, { status: "uploading", progress: 0, error: null });
    try {
      const res = await this.deps.upload(itemId, item.file, (f) =>
        this.patchItem(itemId, { progress: f }),
      );
      if (res.status === "verified") this.patchItem(itemId, { status: "verified", progress: 1 });
      else
        this.patchItem(itemId, {
          status: "failed",
          error: res.failureMessage ?? "ファイルを確認できませんでした",
        });
    } catch (error) {
      this.patchItem(itemId, {
        status: "failed",
        error: describeError(error).message,
      });
    }
  }

  /** 失敗したファイルだけを再送する（A-02 の復旧手順）。 */
  async retry(itemId: string): Promise<void> {
    await this.deps.reset(itemId);
    await this.uploadOne(itemId);
  }

  /** 確定。再送時も同じ requestId を使い、二重版を作らない（A-10）。 */
  async confirm(): Promise<void> {
    if (!canConfirm(this.state) || this.state.sessionId === null)
      throw new Error("まだ確認できていないファイルがあります");
    this.confirmRequestId ??= this.deps.randomId();
    this.set({ confirming: true, error: null });
    try {
      const confirmed = await this.deps.confirm(this.state.sessionId, this.confirmRequestId);
      this.set({ confirming: false, confirmed });
    } catch (error) {
      this.set({
        confirming: false,
        error: describeError(error).message,
      });
      throw error;
    }
  }
}
