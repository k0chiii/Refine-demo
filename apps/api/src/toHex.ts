/** バイト列 → 16 進（SHA-256 の digest など）。 */
export const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
