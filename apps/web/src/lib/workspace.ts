import { isWorkspace, type Workspace } from "@mf100/domain";

/**
 * 最後に使った入口（制作・校正）。端末ごとの覚え書きで、開く入口の選び方は domain の landingWorkspace。
 * localStorage は使えないことがある（プライベートウィンドウ・サイトデータの拒否）ので、読み書きはどちらも失敗を握りつぶす。
 */
const KEY = "mf100.workspace";

export function readWorkspace(): Workspace | null {
  try {
    const v = localStorage.getItem(KEY);
    return isWorkspace(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(KEY, ws);
  } catch {
    // 覚えられなくても、開く入口が既定になるだけ
  }
}

export const workspacePath = { make: "/make", check: "/check" } as const satisfies Record<
  Workspace,
  string
>;
