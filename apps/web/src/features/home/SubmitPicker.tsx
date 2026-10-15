import { api } from "@mf100/convex/api";
import { useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState, type ReactNode } from "react";
import { SubmitDialog } from "@/features/upload/SubmitDialog";
import { formatDeadlineUntil } from "@/lib/format";
import { mediaLabel } from "@/lib/labels";
import { useWindowClass } from "@/lib/useMedia";
import { ActionSheet } from "@/ui/ActionSheet";
import { M3eActionList, M3eButton, M3eDialog, M3eIcon, M3eListAction } from "@/ui/m3e";

export type SubmitTarget = FunctionReturnType<typeof api.home.submitTargets>[number];
type Route = SubmitTarget["route"];

/** 提出の入口のアイコン（添付は版提出、文章は文章エディタ、SNS は投稿の編集） */
export const submitRouteIcon: Record<Route, string> = {
  upload: "upload_file",
  write: "edit_document",
  post: "post_add",
};

/** 自分が版を提出できる制作物（締切順）。判定は application の listSubmitTargets（提出の権限を必ず確かめる） */
export function useSubmitTargets(): SubmitTarget[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.home.submitTargets, isAuthenticated ? {} : "skip");
}

/** 行の 2 行目: 媒体・いまの版・納期 */
export function describeTarget(t: {
  mediaType?: string;
  acceptingLabel?: string | null;
  latestLabel?: string | null;
  deadlineAt: number | null;
}): string {
  const state = t.acceptingLabel
    ? `${t.acceptingLabel}が受付中`
    : t.latestLabel
      ? `最新 ${t.latestLabel}`
      : "まだ版がありません";
  return [
    t.mediaType ? mediaLabel[t.mediaType] : null,
    state,
    t.deadlineAt ? `納期 ${formatDeadlineUntil(t.deadlineAt)}` : null,
  ]
    .filter(Boolean)
    .join("・");
}

/**
 * 版の提出を始める（L-15）。添付の制作物はその場で版提出ダイアログを開き、文章・SNS 投稿はそれぞれのエディタへ移る。
 * `element` を画面に置いておく（ダイアログ）。
 */
export function useSubmitLauncher(): {
  start: (t: { workId: string; route: Route }) => void;
  element: ReactNode;
} {
  const navigate = useNavigate();
  const [target, setTarget] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // 制作物ごとにダイアログを作り直す（前の制作物で選んだファイルを持ち越さない）。開くのは描いた後
  useEffect(() => {
    if (!target) return;
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, [target]);
  const start = (t: { workId: string; route: Route }) => {
    if (t.route === "write")
      void navigate({ to: "/works/$workId/write", params: { workId: t.workId } });
    else if (t.route === "post")
      void navigate({ to: "/works/$workId/post", params: { workId: t.workId } });
    else {
      setOpen(false);
      setTarget(t.workId);
    }
  };
  const element = target ? (
    <SubmitDialog
      key={target}
      workId={target}
      open={open}
      onClose={() => {
        setOpen(false);
        setTarget(null);
      }}
    />
  ) : null;
  return { start, element };
}

const EMPTY = (
  <div className="empty submit-picker__empty">
    <M3eIcon name="upload_file" />
    <span className="title-medium">版を提出できる制作物はありません</span>
    <span className="small">
      あなたが制作者になっている進行中の制作物がないためです。制作物の担当は管理者が登録します。
    </span>
  </div>
);

/**
 * 「版を提出する制作物」を選ぶ（L-15）。FAB「版を提出」から開く。
 * 広い画面は M3E のダイアログ、compact はボトムシート（M3 Breakpoints: compact の補助的な選択はボトムシート）。
 */
export function SubmitPicker({
  open,
  onClose,
  targets,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  targets: readonly SubmitTarget[];
  onPick: (t: SubmitTarget) => void;
}) {
  const compact = useWindowClass() === "compact";
  const title = "版を提出する制作物";
  if (compact)
    return (
      <ActionSheet
        open={open}
        onClose={onClose}
        title={title}
        empty={EMPTY}
        items={targets.map((t) => ({
          icon: submitRouteIcon[t.route],
          label: t.workTitle,
          supporting: describeTarget(t),
          onSelect: () => onPick(t),
        }))}
      />
    );
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" className="submit-picker">
      <span slot="header">{title}</span>
      <div className="dialog-body">
        {/* 閉じている間は中身を描かない（一覧の行が画面の行と重複して見つからないように） */}
        {!open ? null : targets.length === 0 ? (
          EMPTY
        ) : (
          <M3eActionList className="list submit-picker__list" aria-label={title}>
            {targets.map((t) => (
              <M3eListAction
                key={t.workId}
                className="list__item"
                onClick={() => {
                  onClose();
                  onPick(t);
                }}
              >
                <M3eIcon slot="leading" name={submitRouteIcon[t.route]} />
                <span className="list__headline">{t.workTitle}</span>
                <span slot="supporting-text">{describeTarget(t)}</span>
              </M3eListAction>
            ))}
          </M3eActionList>
        )}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
