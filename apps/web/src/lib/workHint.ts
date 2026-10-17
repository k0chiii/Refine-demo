/**
 * 制作物を開いた直後の「ヒント」（題名・媒体）。一覧・ホームで行を押した時点で分かっている値を覚えておき、
 * エディタが works.get の結果を待つあいだも、アプリバーに題名を出し・ビューアの先読みを始められるようにする。
 * （題名が届いてから現れると、読み込み中の画面が 1 段増える。利用者指示 2026-10-17。docs/UI_M3E.md §65）
 * 正本は works.get の結果。ここの値は届くまでの仮表示にだけ使い、保存しない。
 */
export interface WorkHint {
  title: string;
  mediaType?: string;
}

const hints = new Map<string, WorkHint>();

export function rememberWorkHint(workId: string, hint: WorkHint): void {
  hints.set(workId, hint);
  // 開いた分しか増えないが、念のため上限を設ける（古いものから捨てる）
  if (hints.size > 200) hints.delete(hints.keys().next().value as string);
}

export function workHint(workId: string): WorkHint | null {
  return hints.get(workId) ?? null;
}
