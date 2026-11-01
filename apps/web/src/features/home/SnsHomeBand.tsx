import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { useWorkSummaries } from "@/lib/useWorkSummaries";
import { M3eCard } from "@m3e/react/card";
import { M3eHeading } from "@m3e/react/heading";

/**
 * SNS 帯: 進行中の SNS 投稿のうち、自分が統括か校了する人のもの（#173。制作者には出さない）。
 * 組織権限（Nogiku Access 未接続のあいだは全員が持つ）ではなく、制作物の職責で決める
 */
export function SnsHomeBand() {
  const me = useQuery(api.me.me, {});
  const works = useWorkSummaries({ lifecycle: "active" as const });
  if (!me || !works) return null;
  const mine = works.filter(
    (w) =>
      w.mediaType === "sns" &&
      (w.managerIds.includes(me.id) || w.approvers.some((a) => a.id === me.id)),
  );
  if (mine.length === 0) return null;
  return (
    <M3eCard variant="filled" className="sns-home-band">
      <div slot="content">
        <M3eHeading variant="title" size="small" level={2}>
          SNS 投稿
        </M3eHeading>
        <p className="sns-home-band__meta">{mine.length} 件が進行中</p>
      </div>
    </M3eCard>
  );
}
