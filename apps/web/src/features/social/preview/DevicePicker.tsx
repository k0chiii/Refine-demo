import { useState } from "react";
import { M3eFormField, M3eOptGroup, M3eOption, M3eSelect } from "../../../ui/m3e";
import { DEFAULT_DEVICE, DEVICES, deviceById, type DeviceKind } from "./devices";

const GROUPS: readonly [DeviceKind, string][] = [
  ["iphone", "iPhone"],
  ["android", "Android"],
  ["pc", "PC"],
];
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

const valueOf = (e: Event) => {
  const v = (e.target as unknown as { value: string | readonly string[] | null }).value;
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
};

/** 端末の選択（Figma の端末プリセットのように機種で選ぶ）。iPhone は本体の色も選べる */
export function DevicePicker({
  device,
  color,
  onChange,
}: {
  device: string;
  color?: string | undefined;
  onChange: (next: { device: string; color?: string }) => void;
}) {
  const spec = deviceById(device);
  const colors = spec.bezel?.colors ?? [];
  const curColor = colors.some((c) => c.id === color) ? color : colors[0]?.id;
  return (
    <div className="device-picker">
      <M3eFormField variant="outlined" hideSubscript="always" className="device-picker__device">
        <M3eSelect
          aria-label="端末"
          value={spec.id}
          onChange={(e) => onChange({ device: valueOf(e as unknown as Event) })}
        >
          {GROUPS.map(([kind, label]) => (
            <M3eOptGroup key={kind}>
              <span slot="label">{label}</span>
              {DEVICES.filter((d) => d.kind === kind).map((d) => (
                <M3eOption key={d.id} value={d.id}>
                  {d.kind === "pc" ? d.label : `${d.label}（${d.w}×${d.h}）`}
                </M3eOption>
              ))}
            </M3eOptGroup>
          ))}
        </M3eSelect>
      </M3eFormField>
      {colors.length > 1 && curColor ? (
        <M3eFormField variant="outlined" hideSubscript="always" className="device-picker__color">
          <M3eSelect
            aria-label="本体の色"
            value={curColor}
            onChange={(e) => onChange({ device: spec.id, color: valueOf(e as unknown as Event) })}
          >
            {colors.map((c) => (
              <M3eOption key={c.id} value={c.id}>
                {c.label}
              </M3eOption>
            ))}
          </M3eSelect>
        </M3eFormField>
      ) : null}
    </div>
  );
}
