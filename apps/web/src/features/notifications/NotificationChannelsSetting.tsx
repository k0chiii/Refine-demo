import { api } from "@mf100/convex/api";
import {
  ACCOUNT_CHANNELS,
  type AccountChannel,
  type ChannelStatus,
  normalizeSlackEmail,
} from "@mf100/domain";
import { useMutation } from "convex/react";
import type { ReactNode } from "react";
import { describeError } from "@/lib/errors";
import { isImeKeyEvent } from "@/lib/ime";
import { toast } from "@/lib/toast";
import { Field, Select, TextInput } from "@/ui/Field";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList, M3eListItem } from "@m3e/react/list";
import { M3eSwitch } from "@m3e/react/switch";
import type { NotificationSettingsView } from "./useNotificationSettings";

type Destinations = NotificationSettingsView["destinations"];

/**
 * Slack の行の 2 行目（オンにしているとき。メールアドレスなしはオフでも出す: スイッチを入れられない理由）。
 * 引き当てに使うアドレス（Nogiku のメールアドレス、Slack のメールアドレスを書いていればそれ）を名指す
 * （利用者が Slack のプロフィールと見比べられるように。§109・§110）
 */
const SLACK_HINT: Record<ChannelStatus, (address: ReactNode) => ReactNode> = {
  ready: (a) => <>DM で届きます（{a}）</>,
  unresolved: (a) => <>{a} を Slack で確かめています</>,
  not_found: (a) => (
    <>{a} の人が Slack に見つかりません（Slack のプロフィールのメールと同じにしてください）</>
  ),
  cannot_dm: () => "Slack の DM を送れません",
  no_address: () => "送れるメールアドレスが無いため使えません",
  no_workspace: () => "ワークスペースを選んでください",
};

const addressText = (address: string | null) => (
  <span className="notif-channel__address">{address}</span>
);

const CHANNEL: Record<
  AccountChannel,
  {
    label: string;
    icon: string;
    supporting: (d: Destinations) => ReactNode;
    /** オンにできるか（オフにするのはいつでもできる） */
    canTurnOn: (d: Destinations) => boolean;
  }
> = {
  email: {
    label: "Nogiku のメールアドレス",
    icon: "mail",
    supporting: ({ email: s }) =>
      s.address ? addressText(s.address) : "Nogiku のメールアドレスがありません",
    // 予約済みのドメイン（デモ・モックの利用者）でも、アドレスがあれば意思として保存できる。送るかはサーバーが決める（§103）
    canTurnOn: ({ email: s }) => s.address !== null,
  },
  slack: {
    label: "Slack（DM）",
    icon: "forum",
    supporting: ({ slack: s }) =>
      s.workspaces.length === 0 ? (
        "管理者がワークスペースを登録すると使えます"
      ) : s.status === "no_address" || s.on ? (
        SLACK_HINT[s.status](addressText(s.address))
      ) : s.customEmail ? (
        <>{addressText(s.address)} で Slack のメンバーを探して DM で送ります</>
      ) : (
        <>
          Nogiku のメールアドレス（{addressText(s.address)}）で Slack のメンバーを探して DM
          で送ります
        </>
      ),
    // メンバーは送れるメールアドレスで、選んだワークスペースの中から引くので、どちらかが無ければ入れられない
    canTurnOn: ({ slack: s }) => s.status !== "no_address" && s.workspaces.length > 0,
  },
};

const checkedOf = (e: Event) => (e.target as unknown as { checked: boolean }).checked;

/**
 * Slack のメールアドレス（§110。Nogiku のアドレスと Slack のプロフィールのメールが違う人だけが書く）。
 * 離れたとき（Enter は離れるのと同じ）に、変わっていれば保存する。空なら消す。
 * 保存できた値で欄を作り直す（key）。断られたときは作り直さず、打った文字を残す
 */
function SlackEmailField({
  saved,
  nogikuAddress,
  save,
}: {
  saved: string | null;
  nogikuAddress: string | null;
  save: (patch: { slackEmail: string | null }) => void;
}) {
  const commit = (raw: string) => {
    const typed = raw.trim();
    const next = typed === "" ? null : typed;
    const unchanged =
      next === null ? saved === null : (normalizeSlackEmail(next) ?? next) === saved;
    if (!unchanged) save({ slackEmail: next });
  };
  return (
    <div data-field="slackEmail" className="notif-channel__slack-email">
      <Field
        label="Slack のメールアドレス"
        hint={`Nogiku のアドレス${nogikuAddress ? `（${nogikuAddress}）` : ""}と Slack のプロフィールのメールが違うときだけ`}
      >
        <TextInput
          key={saved ?? ""}
          // type="email" にしない: ブラウザの検証は全角で打ったアドレスを誤りとし（ここでは NFKC でそろえて受け付ける）、
          // M3E の欄が赤いまま残る。形はサーバーが確かめる。キーボードは inputMode でメール用にする
          type="text"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          defaultValue={saved ?? ""}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isImeKeyEvent(e.nativeEvent)) e.currentTarget.blur();
          }}
        />
      </Field>
    </div>
  );
}

/**
 * 外への届け先（Nogiku のメールアドレス・Slack（DM）。§103）。アカウントで一度オンにすれば、宛先はアカウントから決まる。
 * env の揃った経路だけ行を出す（デモは両方）。Nogiku のアドレスはここでは変えない。
 * Slack は管理者が登録したワークスペースから、送り先を見出しの下で選ぶ（§105。選んだものは行の data-workspace-id）。
 * その下に Slack のメールアドレスの欄を置く（§110。スイッチを入れる前にも書ける）
 */
export function NotificationChannelsSetting({ settings }: { settings: NotificationSettingsView }) {
  const update = useMutation(api.notificationPrefs.update);
  const shown = ACCOUNT_CHANNELS.filter((c) => settings.destinations[c].available);
  if (shown.length === 0) return null;

  const save = (patch: Parameters<typeof update>[0]) =>
    void update(patch).catch((e: unknown) => toast(describeError(e).message, { kind: "error" }));
  const toggle = (channel: AccountChannel, on: boolean) =>
    save({
      channels: ACCOUNT_CHANNELS.filter((c) =>
        c === channel ? on : settings.channels.includes(c),
      ),
    });

  return (
    <M3eList className="list notif-channels" aria-label="通知の届け先">
      {shown.map((c) => {
        const s = settings.destinations[c];
        const slack = c === "slack" ? settings.destinations.slack : null;
        return (
          <M3eListItem
            key={c}
            className="list__item notif-channel"
            data-channel={c}
            data-status={s.status}
            data-workspace-id={slack?.workspaceId ?? undefined}
          >
            <M3eIcon slot="leading" name={CHANNEL[c].icon} />
            <span className="list__headline" id={`notif-channel-${c}`}>
              {CHANNEL[c].label}
            </span>
            {/* メールアドレスなしでも選べる（選んでおけば、アドレスが入ったときにそのまま送れる） */}
            {slack && slack.workspaces.length > 0 ? (
              <>
                <Field label="ワークスペース" className="notif-channel__workspace">
                  <Select
                    value={slack.workspaceId ?? ""}
                    onChange={(e) => {
                      if (e.target.value) save({ slackWorkspaceId: e.target.value });
                    }}
                  >
                    {slack.workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SlackEmailField
                  saved={slack.customEmail}
                  nogikuAddress={settings.destinations.email.address}
                  save={save}
                />
              </>
            ) : null}
            <span slot="supporting-text">{CHANNEL[c].supporting(settings.destinations)}</span>
            <M3eSwitch
              slot="trailing"
              aria-labelledby={`notif-channel-${c}`}
              checked={s.on}
              icons="selected"
              disabled={!s.on && !CHANNEL[c].canTurnOn(settings.destinations)}
              onChange={(e) => toggle(c, checkedOf(e))}
            />
          </M3eListItem>
        );
      })}
    </M3eList>
  );
}
