import { useState } from "react";
import { M3eSlider, M3eSliderThumb } from "@/ui/m3e";

/**
 * 画像の重ね比較（版比較 §2.3: ピクセル差分の自動強調は必須でないが、比べやすい表示を用意する）。
 * 旧版の上に新版を重ね、スライダーで境目を動かす。どちらの画像も書き換えない。
 */
export function ImageSwipe({
  leftUrl,
  rightUrl,
  leftLabel,
  rightLabel,
}: {
  leftUrl: string;
  rightUrl: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const [pos, setPos] = useState(50);
  return (
    <div className="swipe">
      <div className="swipe__stage">
        <div className="swipe__frame">
          <img src={leftUrl} alt={`${leftLabel}の画像`} className="swipe__img" />
          <img
            src={rightUrl}
            alt={`${rightLabel}の画像`}
            className="swipe__img swipe__img--top"
            style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
          />
          <span className="swipe__line" style={{ left: `${pos}%` }} aria-hidden="true" />
          <span className="swipe__tag swipe__tag--left">{leftLabel}</span>
          <span className="swipe__tag swipe__tag--right">{rightLabel}</span>
        </div>
      </div>
      <div className="swipe__control">
        <M3eSlider
          min={0}
          max={100}
          aria-label="境目の位置"
          onInput={(e: Event) =>
            setPos(Number((e.target as HTMLElement & { value: number }).value))
          }
        >
          <M3eSliderThumb value={pos} />
        </M3eSlider>
      </div>
    </div>
  );
}
