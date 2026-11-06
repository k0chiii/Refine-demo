/**
 * 添付を選ぶ・貼る・落とすときの取り決め（画面を知らない純粋な部分）。
 */

export interface QueueEntry {
  name: string;
  size: number;
}

export interface AddPlan<T extends QueueEntry> {
  /** 受け付けるもの（現在の数と合わせて max 件まで） */
  accepted: T[];
  /** 同じ名前・同じ大きさで、すでに並んでいるもの */
  duplicates: T[];
  /** 上限を超えて受け付けなかった件数 */
  overflow: number;
}

/**
 * 並んでいる添付に、新しく選ばれたものを足す計画。同じ名前・同じ大きさのものは重ねない（選び直し・貼り直しの重複）。
 * 上限（max 件）を超える分は受け付けない。
 */
export function planAdd<T extends QueueEntry>(
  existing: readonly QueueEntry[],
  incoming: readonly T[],
  max: number,
): AddPlan<T> {
  const seen = new Set(existing.map((e) => `${e.name}\u0000${e.size}`));
  const accepted: T[] = [];
  const duplicates: T[] = [];
  let overflow = 0;
  for (const f of incoming) {
    const key = `${f.name}\u0000${f.size}`;
    if (seen.has(key)) {
      duplicates.push(f);
      continue;
    }
    if (existing.length + accepted.length >= max) {
      overflow++;
      continue;
    }
    seen.add(key);
    accepted.push(f);
  }
  return { accepted, duplicates, overflow };
}

/** 同時に走らせる数を絞る（送信の並列度）。先に頼んだものから順に始める */
export function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    if (active >= concurrency) return;
    const run = waiting.shift();
    if (run) {
      active++;
      run();
    }
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

/** クリップボードの内容から、貼り付けとして取り込むファイル。文字も一緒に入っているとき（Word などの貼り付け）は取り込まない */
export function filesFromClipboard(data: {
  files?: ArrayLike<File> | null;
  getData?: (type: string) => string;
}): File[] {
  const files = Array.from(data.files ?? []);
  if (files.length === 0) return [];
  const text = data.getData?.("text/plain") ?? "";
  return text.trim() === "" ? files : [];
}

/** ドラッグの中身がファイルか（ファイルのときだけ、落とす先として受ける） */
export function dragHasFiles(types: ArrayLike<string> | null | undefined): boolean {
  return Array.from(types ?? []).includes("Files");
}

/** 全体の進み具合（0〜1）。完了した分は 1、送っている分はその進み具合、準備中は 0 */
export function overallProgress(items: ReadonlyArray<{ phase: string; progress: number }>): number {
  const live = items.filter((i) => i.phase !== "error");
  if (live.length === 0) return 1;
  const sum = live.reduce((n, i) => n + (i.phase === "done" ? 1 : i.progress), 0);
  return sum / live.length;
}
