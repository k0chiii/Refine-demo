import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerServiceWorker } from "./lib/pwa";
import { installScrollLockGuard } from "./lib/scrollLockGuard";
import { installSnackbarPlacement } from "./lib/toast";
import { routeTree } from "./routeTree.gen";
import "./theme";
import "./fonts";
import "./styles.css";

const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

// デモモード（バックエンド無し）では E2E / スクリーンショットからクライアント側遷移を行えるように公開する
if (import.meta.env.MODE === "demo")
  (globalThis as { __mf100router?: typeof router }).__mf100router = router;

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// スナックバーは下部ナビ・浮遊ツールバー・FAB の上に出す
installSnackbarPlacement();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

registerServiceWorker();
installScrollLockGuard();

// iOS Safari はピンチで画面全体を拡大する（touch-action を見ない場面がある）。拡大はビューアの中だけで行うので、全体の拡大を止める
for (const type of ["gesturestart", "gesturechange"])
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
