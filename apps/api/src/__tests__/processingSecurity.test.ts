import { expect, it } from "vite-plus/test";
import { publicSnapshotUrl } from "../processingSecurity";
it("Browser Run は main・redirect・subresource に同じ HTTPS host 制限を使う", () => {
  const allowed = ["www.mayfes.jp", "127.0.0.1", "localhost", "x.internal"];
  expect(publicSnapshotUrl("https://www.mayfes.jp/page", allowed).hostname).toBe("www.mayfes.jp");
  for (const url of [
    "http://www.mayfes.jp/",
    "https://www.mayfes.jp.evil.com/",
    "https://www.mayfes.jp@evil.com/",
    "https://127.0.0.1/",
    "https://localhost/",
    "https://x.internal/",
    "https://www.mayfes.jp:8443/",
    "https://user:password@www.mayfes.jp/",
  ])
    expect(() => publicSnapshotUrl(url, allowed)).toThrow();
});
