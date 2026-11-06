import { describe, expect, it } from "vite-plus/test";
import { crc32, makeZip } from "./zip";

describe("ZIP（無圧縮）", () => {
  it("CRC32 と中央ディレクトリ", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
    const z = makeZip([
      { name: "本文.txt", data: new TextEncoder().encode("五月祭") },
      { name: "01-a.png", data: new Uint8Array([1, 2, 3]) },
    ]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const cdOffset = v.getUint32(end + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    // 1 件目の中身がそのまま入っている
    const nameLen = v.getUint16(26, true);
    expect(new TextDecoder().decode(z.slice(30 + nameLen, 30 + nameLen + 9))).toBe("五月祭");
  });
});
