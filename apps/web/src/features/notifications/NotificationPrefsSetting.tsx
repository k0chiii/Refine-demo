import { api } from "@mf100/convex/api";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPrefs,
} from "@mf100/domain";
import { useMutation } from "convex/react";
import { describeError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList, M3eListItem } from "@m3e/react/list";
import { M3eSwitch } from "@m3e/react/switch";

const CATEGORY: Record<NotificationCategory, { label: string; icon: string }> = {
  mention: { label: "メンション", icon: "alternate_email" },
  reply: { label: "返信・コメント", icon: "chat" },
  assignment: { label: "割当・確認依頼", icon: "assignment_ind" },
  deadline: { label: "期限・リマインド", icon: "alarm" },
  rule: { label: "表記ルールの提案", icon: "spellcheck" },
  other: { label: "その他", icon: "notifications" },
};

const checkedOf = (e: Event) => (e.target as unknown as { checked: boolean }).checked;

/**
 * 通知の受け取り方（利用者ごと。端末・Nogiku のメールアドレス・Slack（DM）の外へのすべての経路に効く。§103）。
 * 「通知に内容を表示」（iOS の「プレビューを表示」にあたる）と、分類ごとのオン・オフ。
 * アプリ内の通知（ベルの一覧）は、オフにした分類でも届く。
 */
export function NotificationPrefsSetting({ prefs }: { prefs: NotificationPrefs }) {
  const update = useMutation(api.notificationPrefs.update);

  const save = (patch: Parameters<typeof update>[0]) =>
    update(patch).catch((e: unknown) => toast(describeError(e).message, { kind: "error" }));
  const toggleCategory = (category: NotificationCategory, on: boolean) => {
    const muted = new Set<string>(prefs.mutedCategories);
    if (on) muted.delete(category);
    else muted.add(category);
    void save({ mutedCategories: [...muted] });
  };

  return (
    <>
      <M3eList className="list notif-prefs" aria-label="通知の内容">
        <M3eListItem className="list__item">
          <M3eIcon slot="leading" name="visibility" />
          <span className="list__headline" id="notif-prefs-preview">
            通知に内容を表示
          </span>
          <M3eSwitch
            slot="trailing"
            aria-labelledby="notif-prefs-preview"
            checked={prefs.showPreview}
            icons="selected"
            onChange={(e) => void save({ showPreview: checkedOf(e) })}
          />
        </M3eListItem>
      </M3eList>
      <M3eList className="list notif-prefs" aria-label="通知の種類">
        {NOTIFICATION_CATEGORIES.map((c) => (
          <M3eListItem key={c} className="list__item">
            <M3eIcon slot="leading" name={CATEGORY[c].icon} />
            <span className="list__headline" id={`notif-prefs-${c}`}>
              {CATEGORY[c].label}
            </span>
            <M3eSwitch
              slot="trailing"
              aria-labelledby={`notif-prefs-${c}`}
              checked={!prefs.mutedCategories.includes(c)}
              icons="selected"
              onChange={(e) => toggleCategory(c, checkedOf(e))}
            />
          </M3eListItem>
        ))}
      </M3eList>
    </>
  );
}
