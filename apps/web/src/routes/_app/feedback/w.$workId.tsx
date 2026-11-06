import { createFileRoute, redirect } from "@tanstack/react-router";

/** 旧 FB の制作物ごとの画面。FB はコメントへ統合したので、その制作物へ転送する（古いリンク・ブックマーク用） */
export const Route = createFileRoute("/_app/feedback/w/$workId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/works/$workId", params: { workId: params.workId }, replace: true });
  },
});
