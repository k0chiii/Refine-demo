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
  file: File | null; // 外部リンク・Figma からの取り込みは null
  /** 手元のファイル / Figma から取り込む / 外部リンク（実体なし） */
  source: "file" | "figma" | "external";
  /** Figma から取り込む項目のフレーム */
  figma?: { fileKey: string; nodeId: string };
  status: ItemStatus;
  progress: number;
  error: string | null;
}

/** 準備する項目の並びと同じ順で、ファイルの後ろに置く Figma のフレーム */
export interface FigmaFrameSource {
  fileKey: string;
  nodeId: string;
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
  /** Figma のフレームを取り込む（Worker が Figma API → R2 → 採用）。無ければ Figma の項目は失敗にする */
  importFigma?(items: Array<{ itemId: string; fileKey: string; nodeId: string }>): Promise<
    Array<{
      itemId: string;
      status: string;
      failureMessage: string | null;
      nodeName?: string | null;
    }>
  >;
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
    /** 準備する項目のうち、ファイルの次に並ぶ Figma のフレーム（その後ろが外部リンク） */
    private readonly figmaFrames: FigmaFrameSource[] = [],
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
    const n = this.files.length;
    const items: FlowItem[] = prepared.items.map((it, index) => {
      if (it.keyPrefix === null)
        return {
          itemId: it.id,
          fileName: it.fileName,
          file: null,
          source: "external",
          status: "verified",
          progress: 1,
          error: null,
        };
      const frame = index >= n ? this.figmaFrames[index - n] : undefined;
      if (frame)
        return {
          itemId: it.id,
          fileName: it.fileName,
          file: null,
          source: "figma",
          figma: frame,
          status: "pending",
          progress: 0,
          error: null,
        };
      return {
        itemId: it.id,
        fileName: it.fileName,
        file: this.files[index] ?? null,
        source: "file",
        status: "pending",
        progress: 0,
        error: null,
      };
    });
    this.set({ sessionId: prepared.sessionId, items });
    await Promise.all([
      ...items.filter((i) => i.file !== null).map((i) => this.uploadOne(i.itemId)),
      this.importFigma(items.filter((i) => i.source === "figma").map((i) => i.itemId)),
    ]);
  }

  /** Figma のフレームをまとめて取り込む（1 版 1 回の API 呼び出しに収める） */
  private async importFigma(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const targets = this.state.items.filter((i) => itemIds.includes(i.itemId) && i.figma);
    for (const t of targets)
      this.patchItem(t.itemId, { status: "uploading", progress: 0.2, error: null });
    if (!this.deps.importFigma) {
      for (const t of targets)
        this.patchItem(t.itemId, { status: "failed", error: "Figma 連携が未設定です" });
      return;
    }
    try {
      const results = await this.deps.importFigma(
        targets.map((t) => ({
          itemId: t.itemId,
          fileKey: t.figma!.fileKey,
          nodeId: t.figma!.nodeId,
        })),
      );
      for (const t of targets) {
        const r = results.find((x) => x.itemId === t.itemId);
        if (r?.status === "verified")
          this.patchItem(t.itemId, {
            status: "verified",
            progress: 1,
            ...(r.nodeName ? { fileName: `${r.nodeName}.png` } : {}),
          });
        else
          this.patchItem(t.itemId, {
            status: "failed",
            error: r?.failureMessage ?? "Figma から取り込めませんでした",
          });
      }
    } catch (error) {
      for (const t of targets)
        this.patchItem(t.itemId, { status: "failed", error: describeError(error).message });
    }
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
    const item = this.state.items.find((i) => i.itemId === itemId);
    if (item?.source === "figma") await this.importFigma([itemId]);
    else await this.uploadOne(itemId);
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
