import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { bezelUrl, DEFAULT_DEVICE, DEVICES, deviceById, outerSize } from "./devices";

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
});
