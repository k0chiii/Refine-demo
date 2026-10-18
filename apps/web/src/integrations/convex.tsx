import { ConvexAuthProvider, useAuthToken } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { useEffect, useRef, type ReactNode } from "react";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;
if (!CONVEX_URL) console.error("VITE_CONVEX_URL が設定されていません（apps/web/.env.local）");

/**
 * UniQ と同じく Convex Auth を React 側のセッション正本にする。トークンは localStorage に保持される。
 * このモジュールは起動時に読み込まれるので、WebSocket は React の描画より前（モジュール評価の時点）で張り始める。
 *
 * initialAuthTokenReuse: 保存済みのトークンがまだ有効なら、それをそのまま使い続ける。既定（false）では、サーバーが保存済みの
 * トークンを受け入れた直後にも毎回 `auth:signIn`（リフレッシュ）を打ち、新しいトークンで認証し直す。その往復が
 * 1 回余計に走り、認証を張り直すたびにサーバーが全クエリを再実行し、トークンが替わることで画面側の副作用（ファイル取得など）も
 * 再実行されていた。有効期限の手前に予定を立てて更新するので、期限切れのトークンは従来どおり（サーバーが拒否 → 更新）。
 */
export const convexClient = new ConvexReactClient(CONVEX_URL ?? "https://invalid.convex.cloud", {
  initialAuthTokenReuse: true,
});

/**
 * 添付の取得に最新のトークンを渡し、サインアウト・利用者の切り替えで端末の写しを消す（docs/UI_M3E.md §77）。
 * トークンは更新のたびに替わるが、取得の側は都度ここから読む（トークンの更新でファイルを取り直さない）。
 * 起動の最初に読み込むコードを増やさないよう、添付の取得のモジュールは動的に読む（描画をそれで止めない）
 */
function FileSession() {
  const token = useAuthToken();
  const { isLoading } = useConvexAuth();
  const latest = useRef<string | null>(null);
  latest.current = token;
  useEffect(() => {
    let off: (() => void) | null = null;
    let disposed = false;
    void import("@/integrations/api").then(({ artifactFiles }) => {
      if (disposed) return;
      artifactFiles.setTokenProvider(() => latest.current);
      off = () => artifactFiles.setTokenProvider(null);
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    // 認証の読み込み中（トークンがまだ読めていない）は何もしない。確定してから、いまの利用者以外の写しを消す
    if (isLoading) return;
    let cancelled = false;
    void import("@/integrations/api").then(({ artifactFiles }) => {
      if (!cancelled) void artifactFiles.clear(token ? artifactFiles.subjectFor(token) : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [token, isLoading]);
  return null;
}

export function AppConvexProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthProvider client={convexClient}>
      <FileSession />
      {children}
    </ConvexAuthProvider>
  );
}
