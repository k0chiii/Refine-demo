import { api } from "@mf100/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

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
  return (
    <span role="status" title={others.map((user) => user.name).join("、")}>
      {others.length} 人が閲覧中
    </span>
  );
}
