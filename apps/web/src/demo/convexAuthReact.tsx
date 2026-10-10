/** `@convex-dev/auth/react` の差し替え（デモモード）。 */
import type { ReactNode } from "react";
import { demo } from "./backend";

export function ConvexAuthProvider({ children }: { client?: unknown; children: ReactNode }) {
  return <>{children}</>;
}

export function useAuthActions() {
  return {
    async signIn(_provider: string, params?: Record<string, unknown> | FormData) {
      const p = params instanceof FormData ? Object.fromEntries(params.entries()) : (params ?? {});
      const sub = typeof p.sub === "string" && p.sub ? p.sub : "mock-nogiku-creator";
      await demo.signIn(sub, typeof p.name === "string" ? p.name : undefined);
      return { signingIn: true, redirect: undefined as URL | undefined };
    },
    async signOut() {
      demo.signOut();
    },
  };
}

export function useAuthToken(): string | null {
  return demo.userId ? "demo-token" : null;
}
