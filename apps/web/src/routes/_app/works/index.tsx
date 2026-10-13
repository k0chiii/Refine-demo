import { createFileRoute } from "@tanstack/react-router";
import { M3eIcon } from "@/ui/m3e";

export const Route = createFileRoute("/_app/works/")({ component: WorksIndex });

/** 制作物を選んでいないときの右側（広い画面のみ。狭い画面では一覧だけが見える）。 */
function WorksIndex() {
  return (
    <div className="empty list-detail__placeholder">
      <M3eIcon name="folder_open" />
      左の一覧から制作物を選んでください
    </div>
  );
}
