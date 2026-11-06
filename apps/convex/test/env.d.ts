/** http_ece（テストで Web Push の暗号化を標準の実装で復号して確かめる。型定義が無い） */
declare module "http_ece" {
  const ece: {
    decrypt(
      buffer: Buffer,
      params: { version: "aes128gcm"; privateKey: unknown; authSecret: string },
    ): Buffer;
  };
  export default ece;
}
