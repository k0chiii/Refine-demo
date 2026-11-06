/**
 * M3E の outlined の入力欄（m3e-form-field variant="outlined"）と同じ枠。
 * 書式つきの本文（contenteditable）は m3e-form-field の部品として認識されない（input・textarea・select と M3E の一部だけ）ので、
 * 同じ線（角 4・outline 1px・フォーカスで主色の 2px）を自前で描く。ラベルは置かない（利用者指示 2026-10-20「コメントって入れなくていいかもな」）
 */
export function FieldOutline() {
  return <span className="rt__outline" aria-hidden="true" />;
}
