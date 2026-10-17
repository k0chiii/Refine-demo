import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  bezelUrl,
  DEFAULT_DEVICE,
  DEVICES,
  deviceById,
  outerSize,
  WEB_DEFAULT_DEVICE,
  WEB_DEFAULT_PC,
  WEB_DEVICES,
  webDeviceById,
  webDeviceForWidth,
} from "./devices";

const pub = (path: string) => fileURLToPath(new URL(`../../../../public${path}`, import.meta.url));

describe("プレビューの端末", () => {
  it("ID は重複しない・既定の端末がある", () => {
    expect(new Set(DEVICES.map((d) => d.id)).size).toBe(DEVICES.length);
    expect(deviceById(DEFAULT_DEVICE).id).toBe(DEFAULT_DEVICE);
    expect(deviceById("unknown").id).toBe(DEFAULT_DEVICE);
  });
  it("ベゼル画像は全色そろい、画面の穴がベゼルの中央に収まる", () => {
    for (const d of DEVICES) {
      if (!d.bezel) continue;
      expect(d.bezel.x * 2 + d.w, d.id).toBe(d.bezel.w);
      expect(d.bezel.y + d.h, d.id).toBeLessThan(d.bezel.h);
      for (const c of d.bezel.colors)
        expect(existsSync(pub(bezelUrl(d, c.id) ?? "")), `${d.id} ${c.id}`).toBe(true);
    }
  });
  it("外形はベゼルの大きさ、ベゼルのない機種は枠の分だけ大きい", () => {
    expect(outerSize(deviceById("iphone-17-pro"))).toEqual({ w: 450, h: 920 });
    expect(outerSize(deviceById("pixel-10")).w).toBe(360 + 24);
    expect(bezelUrl(deviceById("pixel-10"))).toBeUndefined();
    expect(bezelUrl(deviceById("iphone-17"), "nope")).toBe("/devices/iphone-17--black.webp");
  });
  it("Web の校正の端末: SNS の機種にタブレットと PC の幅を足す。既定は iPhone 17 と PC 1440。SNS の一覧は変えない", () => {
    expect(new Set(WEB_DEVICES.map((d) => d.id)).size).toBe(WEB_DEVICES.length);
    expect(webDeviceById(WEB_DEFAULT_DEVICE)).toMatchObject({ w: 402, h: 874 });
    expect(webDeviceById(WEB_DEFAULT_PC)).toMatchObject({ kind: "pc", w: 1440, h: 0 });
    expect(webDeviceById("unknown").id).toBe(WEB_DEFAULT_DEVICE);
    expect(WEB_DEVICES.some((d) => d.kind === "tablet")).toBe(true);
    expect(DEVICES.some((d) => d.kind === "tablet")).toBe(false);
    expect(DEVICES.filter((d) => d.kind === "pc")).toHaveLength(1);
    expect(outerSize(webDeviceById("ipad-11"))).toEqual({ w: 860, h: 1220 });
    expect(webDeviceForWidth(1440)?.id).toBe("pc-1440");
    expect(webDeviceForWidth(401)).toBeNull();
  });
});
