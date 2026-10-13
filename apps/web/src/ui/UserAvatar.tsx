import { useEffect, useState, type ComponentType } from "react";

type AvatarComponent = ComponentType<{
  assets: unknown;
  seed?: string;
  size?: number | string;
  title?: string;
  className?: string;
  background?: string;
}>;

type Loaded = { Avatar: AvatarComponent; assets: unknown };
let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

/**
 * ユーザーのアバター（Humation）。seed（メール or ID）から決定的に同じ絵が描かれる。
 * アセット（約 700KB）は初回表示時に遅延読み込みし、読み込み前はプレースホルダの円を出す。
 */
export function UserAvatar({
  seed,
  size = 32,
  title,
  className,
}: {
  seed: string;
  size?: number;
  title?: string;
  className?: string;
}) {
  const [mod, setMod] = useState(loaded);
  useEffect(() => {
    if (mod) return;
    loading ??= Promise.all([
      import("@humation/react"),
      import("@humation/assets-humation-1"),
    ]).then(([react, assets]) => {
      loaded = { Avatar: react.Avatar as unknown as AvatarComponent, assets: assets.humation1 };
      return loaded;
    });
    let cancelled = false;
    void loading.then((m) => {
      if (!cancelled) setMod(m);
    });
    return () => {
      cancelled = true;
    };
  }, [mod]);
  if (!mod)
    return (
      <span
        className={`user-avatar user-avatar--placeholder ${className ?? ""}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  const { Avatar, assets } = mod;
  return (
    <Avatar
      assets={assets}
      seed={seed}
      size={size}
      className={`user-avatar ${className ?? ""}`}
      {...(title ? { title } : {})}
    />
  );
}
