/**
 * プレビュー用の線画アイコン（このアプリで描いたもの）。各サービスの公式アイコンやロゴの画像・パスは使わない。
 * 形と大きさ（24px・線 2px 前後）を実物の見た目に寄せている。
 */
const paths = {
  heart:
    "M12 20.3s-7.4-4.5-9.1-9.1C1.7 7.8 4 4.6 7.3 4.6c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.3 0 5.6 3.2 4.4 6.6-1.7 4.6-9.1 9.1-9.1 9.1z",
  bubble: "M20.4 17.6A9 9 0 1 0 17.3 20.5L21.4 21.5z",
  send: "M21.5 2.8 2.7 9.9l7.6 3 3 7.6zM10.3 12.9l11.2-10.1",
  repost:
    "M17 2.8l3.4 3.4L17 9.6M4 11.2V9.6a3.4 3.4 0 0 1 3.4-3.4h13M7 21.2l-3.4-3.4L7 14.4M20 12.8v1.6a3.4 3.4 0 0 1-3.4 3.4h-13",
  bookmark: "M6 3.6h12v17.2l-6-4.6-6 4.6z",
  reply:
    "M4.5 7A3.5 3.5 0 0 1 8 3.5h8A3.5 3.5 0 0 1 19.5 7v5.5A3.5 3.5 0 0 1 16 16h-4.8L7 19.8V16a3.5 3.5 0 0 1-2.5-3.5z",
  views: "M5 20v-7M10 20V7M15 20v-10M20 20V4",
  share:
    "M12 3.5v11.5M7.5 8 12 3.5 16.5 8M5 13.5v5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-5",
  home: "M3.5 10.2 12 3.5l8.5 6.7V20a.5.5 0 0 1-.5.5h-5.2v-6h-5.6v6H4a.5.5 0 0 1-.5-.5z",
  search: "M10.5 3.5a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM15.5 15.5l5 5",
  plusSquare:
    "M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM12 8v8M8 12h8",
  reels:
    "M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM3.5 8.5h17M9 3.5l3 5M14.5 3.5l3 5M10.5 12v5l4.2-2.5z",
  grid: "M3.5 3.5h17v17h-17zM9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17",
  tagged:
    "M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM12 7.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6.5 20.5c1-2.8 3-4.2 5.5-4.2s4.5 1.4 5.5 4.2",
  menu: "M3.5 6.5h17M3.5 12h17M3.5 17.5h17",
  close: "M5 5l14 14M19 5 5 19",
  chevronDown: "M6 9.5l6 6 6-6",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5zM9.8 20.5a2.4 2.4 0 0 0 4.4 0",
  mail: "M3.5 5.5h17v13h-17zM3.5 6.5 12 13l8.5-6.5",
} as const;

export function Icon({
  name,
  size = 24,
  stroke = 2,
  fill,
  className,
}: {
  name: keyof typeof paths | "more" | "verified";
  size?: number;
  stroke?: number;
  fill?: string;
  className?: string;
}) {
  if (name === "more")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
        {[5, 12, 19].map((x) => (
          <circle key={x} cx={x} cy={12} r={1.6} fill="currentColor" />
        ))}
      </svg>
    );
  if (name === "verified")
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-label="認証済み"
        role="img"
        className={className}
      >
        <path
          d="M12 1.8l2.6 2 3.2-.4 1 3.1 2.9 1.5-.8 3.1 1.6 2.8-2.4 2.2-.2 3.2-3.2.4-1.9 2.6-3-1.2-3 1.2-1.9-2.6-3.2-.4-.2-3.2L.9 13.9l1.6-2.8-.8-3.1 2.9-1.5 1-3.1 3.2.4z"
          fill="currentColor"
        />
        <path
          d="M7.6 12.2l3 3 5.8-6"
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d={paths[name]}
        fill={fill ?? "none"}
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 端末のステータスバーの右側（電波・Wi-Fi・電池） */
export function StatusIcons() {
  return (
    <svg width="68" height="12" viewBox="0 0 68 12" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 4.5}
          y={9 - i * 2.6}
          width="3"
          height={3 + i * 2.6}
          rx="0.8"
          fill="currentColor"
        />
      ))}
      <path
        d="M26 4.2a8.5 8.5 0 0 1 11 0M28.2 6.6a5 5 0 0 1 6.6 0M30.4 9a1.6 1.6 0 0 1 2.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="42"
        y="1.5"
        width="22"
        height="9"
        rx="2.6"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.45"
      />
      <rect x="44" y="3.5" width="16" height="5" rx="1.4" fill="currentColor" />
      <rect
        x="65"
        y="4.4"
        width="1.6"
        height="3.2"
        rx="0.8"
        fill="currentColor"
        fillOpacity="0.45"
      />
    </svg>
  );
}
