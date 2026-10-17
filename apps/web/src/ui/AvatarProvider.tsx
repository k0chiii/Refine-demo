import { api } from "@mf100/convex/api";
import type { AvatarConfig } from "@mf100/domain";
import { useQuery } from "convex/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * 画面に出ているユーザーのアバターの設定をまとめて引く（`api.users.avatars`。利用者指示 2026-10-17）。
 * UserAvatar は userId を登録するだけで、この Provider が「いま画面にある ID の集合」で 1 本の購読を持つ。
 * 各クエリ（コメント・FB・メンション候補など）の返り値にアバターを混ぜずに済み、人数が増えても購読は 1 つ。
 * ID の出入りは少し待ってまとめ（リストが順に描かれても購読を作り直し続けない）、読み直し中は前回の値を出す。
 */
class WantedIds {
  private readonly counts = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private snapshot: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  want(id: string): () => void {
    this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    this.schedule();
    return () => {
      const n = (this.counts.get(id) ?? 1) - 1;
      if (n <= 0) this.counts.delete(id);
      else this.counts.set(id, n);
      this.schedule();
    };
  }

  private schedule() {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const next = [...this.counts.keys()].sort();
      if (next.join("\n") === this.snapshot.join("\n")) return;
      this.snapshot = next;
      for (const l of this.listeners) l();
    }, 60);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getIds = () => this.snapshot;
}

interface AvatarContextValue {
  wanted: WantedIds;
  configs: ReadonlyMap<string, AvatarConfig>;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
  const wanted = useMemo(() => new WantedIds(), []);
  const ids = useSyncExternalStore(wanted.subscribe, wanted.getIds, wanted.getIds);
  const rows = useQuery(api.users.avatars, ids.length ? { ids } : "skip");
  // 読み直し中（rows が undefined）は前回の値をそのまま出す。届いたら、聞いた ID の分だけ入れ替える
  const known = useRef(new Map<string, AvatarConfig>());
  const configs = useMemo(() => {
    if (rows === undefined) return known.current;
    const next = new Map(known.current);
    for (const id of ids) next.delete(id);
    for (const r of rows) next.set(r.id, r.avatar);
    known.current = next;
    return next;
  }, [rows, ids]);
  const value = useMemo(() => ({ wanted, configs }), [wanted, configs]);
  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

/**
 * その人の保存済みのアバターの設定（無ければ null）。Provider の外・ID が無いときも null。
 * 画面にある間だけ ID を登録する（`enabled` が偽なら登録しない。設定を直接渡された UserAvatar など）。
 */
export function useUserAvatarConfig(
  userId: string | undefined,
  enabled = true,
): AvatarConfig | null {
  const ctx = useContext(AvatarContext);
  const wanted = ctx?.wanted;
  useEffect(() => {
    if (!wanted || !userId || !enabled) return;
    return wanted.want(userId);
  }, [wanted, userId, enabled]);
  if (!ctx || !userId || !enabled) return null;
  return ctx.configs.get(userId) ?? null;
}
