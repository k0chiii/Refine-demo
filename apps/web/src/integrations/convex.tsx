import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL;
if (!CONVEX_URL) console.error("VITE_CONVEX_URL が設定されていません（apps/web/.env.local）");

/** UniQ と同じく Convex Auth を React 側のセッション正本にする。トークンは localStorage に保持される。 */
export const convexClient = new ConvexReactClient(CONVEX_URL ?? "https://invalid.convex.cloud");

export function AppConvexProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthProvider client={convexClient}>{children}</ConvexAuthProvider>;
}
