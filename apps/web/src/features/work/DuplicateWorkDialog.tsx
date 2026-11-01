import { api } from "@mf100/convex/api";
import { WORK_TITLE_MAX } from "@mf100/domain";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { NewWorkDialog } from "./NewWorkDialog";
import { workFormFromWork, type WorkFormState } from "./WorkForm";

/** 複製の題名: 元の題名に「（コピー）」を添える（上限に収める） */
export function duplicateTitle(title: string): string {
  const suffix = "（コピー）";
  return `${title.slice(0, WORK_TITLE_MAX - suffix.length)}${suffix}`;
}

/**
 * 制作物の複製（利用者 QA 2026-10-24「ほとんど同じ制作物（SNS 投稿）とかに対して、コピーとかできたらいいな。名前と制作者だけくらいが違う」）。
 * 元の制作物の情報（目的・ジャンル・媒体・担当・人・日程・表記のカテゴリ・校正者）で埋めた登録のダイアログを開く。
 * 題名は「（コピー）」付きにして、名前と制作者を直してから登録してもらう。版・コメントは写さない（新しい制作物として始める）。
 * SNS のアカウントは登録の引数に無いので、登録のあとに同じものを割り当てる。登録したら一覧に残り、知らせから開ける。
 */
export function DuplicateWorkDialog({
  sourceWorkId,
  onClose,
}: {
  sourceWorkId: string;
  onClose: () => void;
}) {
  const data = useQuery(api.works.get, { workId: sourceWorkId });
  const update = useMutation(api.works.update);
  const navigate = useNavigate();
  if (!data) return null;
  const { work } = data;
  const base = workFormFromWork(work);
  const form: WorkFormState = {
    ...base,
    title: duplicateTitle(work.title),
    /** 登録（create）必須。元に仕上がり日が無ければ入稿日などから引く */
    finishAt: base.finishAt ?? base.publishAt ?? null,
  };
  return (
    <NewWorkDialog
      open
      onClose={onClose}
      header="制作物を複製"
      submitLabel="複製して登録"
      initial={{ form, reviewerIds: work.reviewerIds ?? [] }}
      onCreated={async (id) => {
        if (work.socialProfileId)
          await update({ workId: id, patch: { socialProfileId: work.socialProfileId } });
        // 閉じかけのダイアログの中に出さない（toast は開いているダイアログの中に出す）。閉じ終わってから
        window.setTimeout(() => {
          toast(`「${form.title}」を登録しました`, {
            action: {
              label: "開く",
              run: () => void navigate({ to: "/works/$workId", params: { workId: id } }),
            },
          });
        }, 0);
      }}
    />
  );
}
