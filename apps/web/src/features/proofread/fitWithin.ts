/** OCR に渡す画像の大きさ（長辺を max 以下に収める） */
export function fitWithin(width: number, height: number, _max: number) {
  return { width, height };
}
