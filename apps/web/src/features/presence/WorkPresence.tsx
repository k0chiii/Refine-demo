import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { UserAvatar } from "@/ui/UserAvatar";

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
  const names = others.map((user) => user.name).join("、");
  const shown = others.slice(0, SHOWN);
  const rest = others.length - shown.length;
  // 見ている人はアバターを重ねて出す（Google ドキュメントと同じ）。誰かは title と読み上げ名で
  return (
    <span
      className="work-presence"
      role="status"
      aria-label={`${others.length} 人が閲覧中: ${names}`}
      title={names}
    >
      {shown.map((user) => (
        <UserAvatar
          key={user.userId}
          seed={user.email ?? user.userId}
          userId={user.userId}
          size={28}
          className="work-presence__avatar"
        />
      ))}
      {rest > 0 ? <span className="work-presence__more">+{rest}</span> : null}
    </span>
  );
}

