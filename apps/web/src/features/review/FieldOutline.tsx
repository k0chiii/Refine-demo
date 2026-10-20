/**
 * M3E の outlined の入力欄（m3e-form-field variant="outlined"）と同じ枠と、枠に乗るラベル。
 * 書式つきの本文（contenteditable）は m3e-form-field の部品として認識されない（input・textarea・select と M3E の一部だけ）ので、
 * 同じ形（左 12px・ラベルの切り欠き・残り）を自前で描く。浮かせるかどうかは親の .rt--float と :focus-within で決める
 */
export function FieldOutline({ label }: { label: string }) {
  return (
    <>
      <span className="rt__outline" aria-hidden="true">
        <span className="rt__outline-start" />
        <span className="rt__outline-notch">
          <span className="rt__outline-label">{label}</span>
        </span>
        <span className="rt__outline-end" />
      </span>
      <span className="rt__label" aria-hidden="true">
        {label}
      </span>
    </>
  );
}
