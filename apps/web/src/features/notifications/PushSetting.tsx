import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { describeError } from "@/lib/errors";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  pushSupport,
  type PushSupport,
} from "@/lib/push";
import { toast } from "@/lib/toast";
import { M3eIcon, M3eSwitch } from "@/ui/m3e";

/**
 * 通知パネルの一番上:「この端末にも通知を送る」スイッチ（Web Push）。
 * サーバーに鍵が無い（Web Push を使わない環境・デモ）ときは出さない。
 * iPhone の Safari ではスイッチの代わりに「ホーム画面に追加すると受け取れる」と案内する。
 */
export function PushSetting() {
  const config = useQuery(api.push.config, {});
  const [support, setSupport] = useState<PushSupport>(() => pushSupport());
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subscribed = useQuery(api.push.status, endpoint ? { endpoint } : "skip");
  const subscribe = useMutation(api.push.subscribe);
  const unsubscribe = useMutation(api.push.unsubscribe);

  useEffect(() => {
    if (support !== "available") return;
    void currentPushSubscription().then((s) => setEndpoint(s?.endpoint ?? null));
  }, [support]);

  if (!config) return null;
  if (support === "unsupported") return null;
  const on = endpoint !== null && subscribed === true;

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      if (next) {
        const sub = await enablePush(config.publicKey);
        if (!sub) {
          setSupport(pushSupport());
          toast("通知が許可されませんでした", { kind: "warning" });
          return;
        }
        await subscribe(sub);
        setEndpoint(sub.endpoint);
      } else {
        const gone = await disablePush();
        if (gone) await unsubscribe({ endpoint: gone });
        setEndpoint(null);
      }
    } catch (e) {
      toast(describeError(e).message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notif-push">
      <M3eIcon
        name={on ? "notifications_active" : "notifications_off"}
        className="notif-push__icon"
      />
      <div className="notif-push__text">
        <span className="notif-push__label" id="notif-push-label">
          この端末にも通知を送る
        </span>
        <span className="notif-push__hint">
          {support === "needs_install"
            ? "iPhone・iPad は「ホーム画面に追加」したアプリで受け取れます"
            : support === "denied"
              ? "ブラウザの設定で通知が拒否されています"
              : "アプリを閉じていても、題名と制作物名を知らせます"}
        </span>
      </div>
      {support === "available" ? (
        <M3eSwitch
          aria-labelledby="notif-push-label"
          checked={on}
          icons="selected"
          {...(busy || (endpoint !== null && subscribed === undefined) ? { disabled: true } : {})}
          onChange={(e) => void toggle((e.target as unknown as { checked: boolean }).checked)}
        />
      ) : null}
    </div>
  );
}
