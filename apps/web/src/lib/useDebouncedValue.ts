import { useEffect, useState } from "react";

/**
 * 値が変わってから `ms` ミリ秒たったら追いつく値。検索語のように、打つたびに変わる値を Convex の問い合わせの引数にするとき、
 * 1 文字ごとに購読を作り直さない（引数が変わるたびに新しい問い合わせが走り、読み取りがそのたびに積み上がる）ために使う。
 * `immediate(value)` が真の値（空の検索語など）はすぐに反映する（候補を開いた直後や、選んで空にしたときに待たせない）。
 */
export function useDebouncedValue<T>(
  value: T,
  ms: number,
  immediate: (value: T) => boolean = () => false,
): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (immediate(value)) {
      setSettled(value);
      return;
    }
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return immediate(value) ? value : settled;
}
