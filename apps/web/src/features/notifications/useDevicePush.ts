import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  localNotifyEnabled,
  pushSupport,
  setLocalNotify,
  showDeviceNotification,
  type PushSupport,
} from "@/lib/push";

/** サーバーの無いデモ（convex-test をブラウザで動かす）。Web Push は届かないので、この端末の中だけで通知を出す */
const DEMO = import.meta.env.MODE === "demo";

/** オンにした直後に出す確認の通知（バナーとアイコンの数字がどう見えるかを、その場で確かめられるように） */
const confirm = () =>
  showDeviceNotification({
    title: "通知をオンにしました",
    body: "新しい通知は、このようにバナーで届きます。未読の数はアプリのアイコンにも出ます",
    tag: "mf100-push-enabled",
    inApp: true,
  });

/**
 * この端末への通知（Web Push）の状態と操作。通知パネルのスイッチと、開いたときの「通知をオンにしますか？」で共用する。
 * - サーバーに鍵があれば Web Push（購読して Convex から届く）
 * - デモ（サーバー無し）は「この端末の中だけ」（許可を取り、アプリの中で起きた通知をこの端末で出す）
 * - どちらでもない（鍵の無い本番など）は使えない（usable: false）
 */
export function useDevicePush() {
  const config = useQuery(api.push.config, {});
  const [support, setSupport] = useState<PushSupport>(() => pushSupport());
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [localOn, setLocalOn] = useState(
    () =>
      DEMO &&
      localNotifyEnabled() &&
      pushSupport() === "available" &&
      Notification.permission === "granted",
  );
  const [busy, setBusy] = useState(false);
  const subscribed = useQuery(api.push.status, endpoint && config ? { endpoint } : "skip");
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);
  const local = DEMO && config === null;

  useEffect(() => {
    if (support !== "available" || !config) return;
    void currentPushSubscription().then((s) => setEndpoint(s?.endpoint ?? null));
  }, [support, config]);

  const on = local ? localOn : endpoint !== null && subscribed === true;
  const pending = busy || (!local && endpoint !== null && subscribed === undefined);

  /** オンにする（必ず利用者の操作から呼ぶ。iOS は操作の中でしか許可を聞けない）。許可されなければ false */
  const enable = async (): Promise<boolean> => {
    setBusy(true);
    try {
      if (local) {
        const permission = await Notification.requestPermission();
        setSupport(pushSupport());
        if (permission !== "granted") return false;
        setLocalNotify(true);
        setLocalOn(true);
        await confirm();
        return true;
      }
      if (!config) return false;
      const sub = await enablePush(config.publicKey);
      setSupport(pushSupport());
      if (!sub) return false;
      await subscribe(sub);
      setEndpoint(sub.endpoint);
      await confirm();
      return true;
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    try {
      if (local) {
        setLocalNotify(false);
        setLocalOn(false);
        return;
      }
      const gone = await disablePush();
      if (gone) await unsubscribe({ endpoint: gone });
      setEndpoint(null);
    } finally {
      setBusy(false);
    }
  };

  return {
    /** サーバーの設定を読み終えた */
    ready: config !== undefined,
    /** この環境で端末への通知が使える */
    usable: config !== undefined && (config !== null || DEMO),
    local,
    support,
    on,
    pending,
    enable,
    disable,
  };
}
