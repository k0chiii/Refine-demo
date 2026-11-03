import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useId } from "react";
import { UserAvatar } from "@/ui/UserAvatar";
import { M3eTooltip } from "@m3e/react/tooltip";

/** 並べて出すアバターの数。それより多い分は「+n」 */
const SHOWN = 3;

/** Show only viewers of this authorized work; independent tabs share one person in the list. */
export function WorkPresence(props: { workId: string }) {
  // Each demo tab owns an isolated in-memory DB. Shared presence needs the real backend;
  // component background jobs also require real async context isolation.
  if (import.meta.env.MODE === "demo") return null;
  return <LiveWorkPresence {...props} />;
}

function LiveWorkPresence({ workId }: { workId: string }) {
  const viewers = useQuery(api.presence.list, { workId });
  const heartbeat = useMutation(api.presence.heartbeat);
  const disconnect = useMutation(api.presence.disconnect);
  useEffect(() => {
    const sessionId = crypto.randomUUID();
    let token: string | undefined;
    let stopped = false;
    let running = false;
    const send = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const response = await heartbeat({ workId, sessionId });
        if (stopped) await disconnect({ sessionToken: response.sessionToken });
        else token = response.sessionToken;
      } catch {
        // Revoked access or lost connection: the component expires the session server-side.
      } finally {
        running = false;
      }
    };
    void send();
    // 間隔はサーバー（convex/presence.ts の INTERVAL）と合わせる。部品は 2.5 倍の間、心拍が無ければ切れたとみなす
    const timer = window.setInterval(() => {
      void send();
    }, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      if (token) void disconnect({ sessionToken: token }).catch(() => {});
    };
  }, [workId, heartbeat, disconnect]);
  const others = viewers?.filter((user) => !user.isMe) ?? [];
  if (!others.length) return null;
  return <ViewerAvatars viewers={others} />;
}

/**
 * 見ている人のアバターを少し重ねて並べる（Google ドキュメントと同じ）。乗せる・フォーカスすると名前がツールチップで出る。
 * 4 人目からは「+n」（乗せると残りの名前）
 */
function ViewerAvatars({
  viewers,
}: {
  viewers: Array<{ userId: string; name: string; email: string | null }>;
}) {
  const idPrefix = useId();
  const shown = viewers.slice(0, SHOWN);
  const hidden = viewers.slice(SHOWN);
  const moreId = `${idPrefix}-more`;
  return (
    <span
      className="work-presence"
      role="status"
      aria-label={`${viewers.length} 人が閲覧中: ${viewers.map((user) => user.name).join("、")}`}
    >
      {shown.map((user, i) => {
        const id = `${idPrefix}-${i}`;
        return (
          <span key={user.userId} id={id} className="work-presence__person" tabIndex={0}>
            <UserAvatar
              seed={user.email ?? user.userId}
              userId={user.userId}
              size={28}
              className="work-presence__avatar"
            />
            <M3eTooltip htmlFor={id} touchGestures="auto">
              {user.name}
            </M3eTooltip>
          </span>
        );
      })}
      {hidden.length > 0 ? (
        <span id={moreId} className="work-presence__person" tabIndex={0}>
          <span className="work-presence__more">+{hidden.length}</span>
          <M3eTooltip htmlFor={moreId} touchGestures="auto">
            {hidden.map((user) => user.name).join("、")}
          </M3eTooltip>
        </span>
      ) : null}
    </span>
  );
}
