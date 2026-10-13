import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface GutterItem {
  id: string;
  /** 望ましい縦位置（ページ基準 px）。位置の無いものは末尾に並ぶ */
  y: number | null;
  node: ReactNode;
}

const GAP = 8;

/**
 * Google ドキュメント式のコメント列。各カードを対応するピン・範囲の高さに置き、重なる分だけ下へ押し出す。
 * 高さは描画後に測る（ResizeObserver）ので、返信欄の開閉にも追従する。
 */
export function AlignedGutter({
  items,
  minHeight,
  activeId,
}: {
  items: GutterItem[];
  minHeight: number;
  activeId: string | null;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [tops, setTops] = useState<Map<string, number>>(new Map());
  const [height, setHeight] = useState(minHeight);
  const key = items.map((i) => `${i.id}@${i.y ?? "-"}`).join("|");

  useLayoutEffect(() => {
    const layout = () => {
      const anchored = items
        .filter((i) => i.y !== null)
        .sort((a, b) => a.y! - b.y! || a.id.localeCompare(b.id));
      const loose = items.filter((i) => i.y === null);
      const next = new Map<string, number>();
      let cursor = 0;
      const place = (id: string, want: number) => {
        const top = Math.max(want, cursor);
        next.set(id, top);
        cursor = top + (refs.current.get(id)?.offsetHeight ?? 0) + GAP;
      };
      // 選択中のカードは自分の高さに固定し、その上のカードは重ならないよう上へ詰める
      const activeIndex = anchored.findIndex((i) => i.id === activeId);
      if (activeIndex > 0) {
        const active = anchored[activeIndex]!;
        let limit = active.y!;
        const above: Array<[string, number]> = [];
        for (let i = activeIndex - 1; i >= 0; i--) {
          const it = anchored[i]!;
          const h = refs.current.get(it.id)?.offsetHeight ?? 0;
          const top = Math.min(it.y!, limit - h - GAP);
          above.push([it.id, Math.max(0, top)]);
          limit = Math.max(0, top);
        }
        for (const [id, top] of above.reverse()) {
          next.set(id, top);
          cursor = top + (refs.current.get(id)?.offsetHeight ?? 0) + GAP;
        }
        for (let i = activeIndex; i < anchored.length; i++) place(anchored[i]!.id, anchored[i]!.y!);
      } else {
        for (const it of anchored) place(it.id, it.y!);
      }
      if (loose.length > 0) {
        cursor = Math.max(cursor, minHeight + GAP);
        for (const it of loose) place(it.id, cursor);
      }
      setTops(next);
      setHeight(Math.max(minHeight, cursor));
    };
    layout();
    const ro = new ResizeObserver(layout);
    for (const el of refs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [key, minHeight, activeId]);

  return (
    <div className="gutter" style={{ height }}>
      {items.map((it) => (
        <div
          key={it.id}
          ref={(el) => {
            if (el) refs.current.set(it.id, el);
            else refs.current.delete(it.id);
          }}
          className={`gutter__item ${it.id === activeId ? "gutter__item--active" : ""}`}
          style={{ top: tops.get(it.id) ?? it.y ?? 0 }}
        >
          {it.node}
        </div>
      ))}
    </div>
  );
}
