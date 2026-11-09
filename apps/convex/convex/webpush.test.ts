// @vitest-environment node
// 暗号化の相互運用（RFC 8291）を、標準の実装（http_ece。web-push ライブラリが使うもの）で復号して確かめる。
// 暗号の本体は @mf100/platform（WebCrypto）。Convex の Node ランタイムで同じ結果になることをここで見る
import { createECDH, randomBytes } from "node:crypto";
import { base64urlEncode, encryptPushPayload } from "@mf100/platform";
import ece from "http_ece";
import { describe, expect, it } from "vite-plus/test";

describe("Web Push の暗号化", () => {
  it("端末の鍵で暗号化した本文を、標準の実装で復号できる（aes128gcm）", async () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const r = {
      p256dh: base64urlEncode(new Uint8Array(ecdh.getPublicKey())),
      auth: base64urlEncode(new Uint8Array(randomBytes(16))),
    };
    const text = JSON.stringify({ title: "新しいコメント", body: "『夏のポスター』" });
    const sealed = await encryptPushPayload(new TextEncoder().encode(text), r);
    const opened = ece.decrypt(Buffer.from(sealed), {
      version: "aes128gcm",
      privateKey: ecdh,
      authSecret: r.auth,
    });
    expect(opened.toString("utf8")).toBe(text);
  });
});
