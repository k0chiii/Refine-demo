import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * 旧 FB の入口。FB はコメントへ統合した（docs/UI_M3E.md §95）ので、制作物の一覧へ転送する（古いリンク・ブックマーク用）
 */
export const Route = createFileRoute("/_app/feedback/")({
  beforeLoad: () => {
    throw redirect({ to: "/works", replace: true });
  },
});
