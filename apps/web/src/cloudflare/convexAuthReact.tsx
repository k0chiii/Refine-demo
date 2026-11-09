/** `@convex-dev/auth/react` の差し替え（`--mode cloudflare`）。セッションの正本は cloudflare/client.ts。 */
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { cloudflare } from "./client";

export function ConvexAuthProvider({ children }: { client?: unknown; children: ReactNode }) {
  return <>{children}</>;
}

export function useAuthActions() {
  return useMemo(
    () => ({
      signIn(_provider: string, params?: Record<string, unknown> | FormData) {
        const p =
          params instanceof FormData ? Object.fromEntries(params.entries()) : (params ?? {});
        return cloudflare.signIn(p);
      },
      signOut: () => cloudflare.signOut(),
    }),
    [],
  );
}

/** access token（期限の前に更新される）。ファイルの API（apps/api）へ渡すのも、integrations/convex.tsx 経由でこの値 */
export function useAuthToken(): string | null {
  return useSyncExternalStore(cloudflare.subscribeAuth, cloudflare.getToken);
}
