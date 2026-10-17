import type { M3eButtonGroupElement } from "@m3e/web/button-group";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { M3eButton, M3eButtonGroup, M3eIcon } from "./m3e";

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  icon?: string;
  disabled?: boolean;
}

type ToggleButton = HTMLElement & { selected: boolean };

/**
 * 1 つを選ぶ切り替え（M3 Button groups の connected。M3 Expressive では segmented button は勧めず、connected の
 * ボタングループに置き換える。§49）。M3E の button group は multi でないとき radiogroup になり、ボタンは toggle。
 * 選択は呼び出し側の値が正。押した瞬間に M3E が自分で選択を外すことがあるので、描画のたびと押した直後に値へ揃える。
 * M3E は group を radiogroup・ボタンを radio にするのに、トグルの aria-pressed も付ける（radio には使えない属性）ので、
 * aria-checked に置き換える。
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  choices,
  onChange,
  className,
  disabled,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<M3eButtonGroupElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const sync = () =>
    ref.current?.querySelectorAll<ToggleButton>("m3e-button[data-value]").forEach((b) => {
      const on = b.dataset.value === latest.current;
      if (b.selected !== on) b.selected = on;
    });
  useLayoutEffect(sync);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fix = (b: Element) => {
      if (b.getAttribute("role") !== "radio" || !b.hasAttribute("aria-pressed")) return;
      b.setAttribute("aria-checked", String((b as ToggleButton).selected));
      b.removeAttribute("aria-pressed");
    };
    root.querySelectorAll("m3e-button").forEach(fix);
    const mo = new MutationObserver((records) => records.forEach((r) => fix(r.target as Element)));
    mo.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "role"],
    });
    return () => mo.disconnect();
  }, []);
  return (
    <M3eButtonGroup
      ref={ref}
      variant="connected"
      size="small"
      aria-label={label}
      className={`choice-group ${className ?? ""}`}
    >
      {choices.map((c) => (
        <M3eButton
          key={c.value}
          toggle
          variant="tonal"
          data-value={c.value}
          selected={c.value === value}
          disabled={Boolean(disabled || c.disabled)}
          onClick={() => {
            if (c.value !== latest.current) onChange(c.value);
            requestAnimationFrame(sync);
          }}
        >
          {c.icon ? <M3eIcon slot="icon" name={c.icon} /> : null}
          {c.label}
        </M3eButton>
      ))}
    </M3eButtonGroup>
  );
}
