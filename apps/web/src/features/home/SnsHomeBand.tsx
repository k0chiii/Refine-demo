import { api } from "@mf100/convex/api";
import { useQuery } from "convex/react";
import { M3eCard } from "@m3e/react/card";
import { M3eHeading } from "@m3e/react/heading";

/** SNS 帯: 校了者または制作物登録権限（SNS 主管相当）だけ */
export function SnsHomeBand() {
  const me = useQuery(api.me.me, {});
  const make = useQuery(api.dashboard.make, {});
  if (!me?.canAssignApprovers && !me?.canCreateWorks) return null;
  const active = make?.works.length ?? 0;
  if (active === 0) return null;
  return (
    <M3eCard variant="filled" className="sns-home-band">
      <div slot="content">
        <M3eHeading variant="title" size="small" level={2}>
          SNS 投稿
        </M3eHeading>
        <p className="sns-home-band__meta">{active} 件が進行中</p>
      </div>
    </M3eCard>
  );
}
