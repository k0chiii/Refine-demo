import { api } from "@mf100/convex/api";
import { ACCOUNT_CHANNELS, type AccountChannel, type ChannelStatus } from "@mf100/domain";
import { useMutation } from "convex/react";
import type { ReactNode } from "react";
import { describeError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList, M3eListItem } from "@m3e/react/list";
import { M3eSwitch } from "@m3e/react/switch";
import type { NotificationSettingsView } from "./useNotificationSettings";

type ChannelSetting = NotificationSettingsView["destinations"][AccountChannel];

/** Slack の行の 2 行目（オンにしているとき。メールアドレスなしはオフでも出す: スイッチを入れられない理由） */
const SLACK_HINT: Record<ChannelStatus, string> = {
  ready: "DM で届きます",
  unresolved: "Slack のメンバーを確かめています",
  not_found: "このメールアドレスの人が Slack に見つかりません",
  cannot_dm: "Slack の DM を送れません",
  no_address: "送れるメールアドレスが無いため使えません",
};

const CHANNEL: Record<
  AccountChannel,
  {
    label: string;
    icon: string;
    supporting: (s: ChannelSetting) => ReactNode;
    /** オンにできるか（オフにするのはいつでもできる） */
    canTurnOn: (s: ChannelSetting) => boolean;
  }
> = {
  email: {
    label: "登録メールアドレス",
    icon: "mail",
    supporting: (s) =>
      s.address ? (
        <span className="notif-channel__address">{s.address}</span>
      ) : (
        "登録メールアドレスがありません"
      ),
    // 予約済みのドメイン（デモ・モックの利用者）でも、アドレスがあれば意思として保存できる。送るかはサーバーが決める（§103）
    canTurnOn: (s) => s.address !== null,
  },
  slack: {
    label: "Slack（DM）",
    icon: "forum",
    supporting: (s) =>
      s.status === "no_address" || s.on
        ? SLACK_HINT[s.status]
        : "登録メールアドレスで Slack のメンバーを探して DM で送ります",
    // メンバーは送れるメールアドレスで引くので、それが無ければ入れられない
    canTurnOn: (s) => s.status !== "no_address",
  },
};

const checkedOf = (e: Event) => (e.target as unknown as { checked: boolean }).checked;

/**
 * 外への届け先（登録メールアドレス・Slack（DM）。§103）。アカウントで一度オンにすれば、宛先はアカウントから決まる。
 * env の揃った経路だけ行を出す（デモは両方）。アドレスはここでは変えない
 */
export function NotificationChannelsSetting({ settings }: { settings: NotificationSettingsView }) {
  const update = useMutation(api.notificationPrefs.update);
  const shown = ACCOUNT_CHANNELS.filter((c) => settings.destinations[c].available);
  if (shown.length === 0) return null;

  const toggle = (channel: AccountChannel, on: boolean) => {
    const next = ACCOUNT_CHANNELS.filter((c) =>
      c === channel ? on : settings.channels.includes(c),
    );
    update({ channels: next }).catch((e: unknown) =>
      toast(describeError(e).message, { kind: "error" }),
    );
  };

  return (
    <M3eList className="list notif-channels" aria-label="通知の届け先">
      {shown.map((c) => {
        const s = settings.destinations[c];
        return (
          <M3eListItem
            key={c}
            className="list__item notif-channel"
            data-channel={c}
            data-status={s.status}
          >
            <M3eIcon slot="leading" name={CHANNEL[c].icon} />
            <span className="list__headline" id={`notif-channel-${c}`}>
              {CHANNEL[c].label}
            </span>
            <span slot="supporting-text">{CHANNEL[c].supporting(s)}</span>
            <M3eSwitch
              slot="trailing"
              aria-labelledby={`notif-channel-${c}`}
              checked={s.on}
              icons="selected"
              disabled={!s.on && !CHANNEL[c].canTurnOn(s)}
              onChange={(e) => toggle(c, checkedOf(e))}
            />
          </M3eListItem>
        );
      })}
    </M3eList>
  );
}
