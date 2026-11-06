import { useState } from "react";
import { DEFAULT_DEVICE, DEVICES } from "./devices";

const KEY = "mf100.preview.device";

/** 選んだ端末と色（見る人ごとに覚える。保存できない環境では毎回既定に戻る） */
export function usePreviewDevice() {
  const [state, setState] = useState<{ device: string; color?: string }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
        device?: string;
        color?: string;
      } | null;
      if (saved?.device && DEVICES.some((d) => d.id === saved.device))
        return { device: saved.device, ...(saved.color ? { color: saved.color } : {}) };
    } catch {
      /* 保存できない環境 */
    }
    return { device: DEFAULT_DEVICE };
  });
  const update = (next: { device: string; color?: string }) => {
    setState(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 保存できない環境 */
    }
  };
  return { ...state, set: update };
}
