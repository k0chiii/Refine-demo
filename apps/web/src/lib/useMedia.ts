import { useEffect, useState } from "react";

/** CSS メディアクエリに一致するかを追う（SSR では false）。 */
export function useMedia(query: string) {
  const [m, setM] = useState(() =>
    typeof window === "undefined" ? false : matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

/**
 * M3 のウィンドウサイズクラス（Layout › Window size classes）。
 * compact < 600、medium 600–839、expanded 840–1199、large 1200 以上（extra-large は large と同じ扱い）。
 * styles.css のメディアクエリ（599 / 839 / 1199）と対にする。
 */
export type WindowClass = "compact" | "medium" | "expanded" | "large";
export function useWindowClass(): WindowClass {
  const compact = useMedia("(max-width: 599px)");
  const medium = useMedia("(min-width: 600px) and (max-width: 839px)");
  const expanded = useMedia("(min-width: 840px) and (max-width: 1199px)");
  if (compact) return "compact";
  if (medium) return "medium";
  if (expanded) return "expanded";
  return "large";
}
