import type { AvatarConfig } from "@mf100/domain";
import { useMemo } from "react";
import { sanitizeAvatarConfig, useHumation } from "@/lib/avatar";
import { useUserAvatarConfig } from "./AvatarProvider";
import { M3eSkeleton } from "@m3e/react/skeleton";

/**
 * ユーザーのアバター（Humation）。
 * - 本人が選んだ設定（`config`。または `userId` で AvatarProvider から引いた保存値）があればその絵
 * - 無ければ seed（メール or ID）から決定的に同じ絵が描かれる
 * アセット（約 700KB）は初回表示時に遅延読み込みし、読み込み前は同じ大きさの円のスケルトン（M3E skeleton。配置が動かない）を出す。
 * 保存値に知らない部品があっても描画が止まらないよう、アセットに照らして捨てる（lib/avatar の sanitize）。
 */
export function UserAvatar({
  seed,
  userId,
  config,
  size = 32,
  title,
  className,
}: {
  seed: string;
  /** その人の ID（保存済みの設定を Provider から引く。無ければ seed だけで描く） */
  userId?: string;
  /** 設定を直接渡す（自分の me など。null は「設定なし」。渡したときは Provider を見ない） */
  config?: AvatarConfig | null;
  size?: number;
  title?: string;
  className?: string;
}) {
  const mod = useHumation();
  const fromStore = useUserAvatarConfig(userId, config === undefined);
  const chosen = config !== undefined ? config : fromStore;
  const safe = useMemo(() => (mod ? sanitizeAvatarConfig(mod, chosen) : null), [mod, chosen]);
  if (!mod)
    return (
      <M3eSkeleton shape="circular" aria-hidden="true">
        <span
          className={`user-avatar user-avatar--placeholder ${className ?? ""}`}
          style={{ width: size, height: size }}
        />
      </M3eSkeleton>
    );
  const { Avatar, manifest } = mod;
  return (
    <Avatar
      assets={manifest}
      seed={safe?.seed ?? seed}
      {...(safe?.selections ? { selections: safe.selections } : {})}
      {...(safe?.colors ? { colors: safe.colors } : {})}
      {...(safe?.background ? { background: safe.background } : {})}
      size={size}
      className={`user-avatar ${className ?? ""}`}
      {...(title ? { title } : {})}
    />
  );
}
