import { WORK_TAG_LENGTH_MAX, WORK_TAG_MAX, workTagOptions } from "@mf100/domain";
import type { M3eFilterChipElement } from "@m3e/web/chips";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { QuestionHead } from "@/ui/Field";
import { M3eFilterChip, M3eFormField, M3eIcon, M3eInputChip } from "@/ui/m3e";

/**
 * タグ（Notion の制作物 DB の multi_select）。Notion にある選択肢は filter chip で押して付け外し、
 * ほかの語は下の欄に書いて Enter（M3 Chips: 選んだものは input chip、候補は filter chip）。
 */
export function TagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const t = raw.normalize("NFKC").trim();
    if (t === "" || value.includes(t) || value.length >= WORK_TAG_MAX) return;
    onChange([...value, t]);
    setText("");
  };
  const toggle = (t: string) =>
    value.includes(t) ? onChange(value.filter((x) => x !== t)) : add(t);
  const custom = value.filter((t) => !(workTagOptions as readonly string[]).includes(t));
  return (
    <div className="picker q tag-picker" role="group" aria-labelledby={`${id}-label`}>
      <QuestionHead
        htmlFor={`${id}-input`}
        labelId={`${id}-label`}
        label="タグ"
        hint="Notion のタグと同じ選択肢。ほかの語も書いて追加できます"
        hintId={`${id}-hint`}
      />
      {/* 複数を選ぶ filter chip。M3E の filter chip set（multi）は持てない属性（aria-checked）が付くので、
          ただの group にして、チップは押すたびに反転するボタン（aria-pressed）にする（制作物一覧の MenuChip と同じ直し方） */}
      <div role="group" aria-label="タグの選択肢" className="tag-picker__options">
        {workTagOptions.map((t) => (
          <ToggleChip key={t} selected={value.includes(t)} onToggle={() => toggle(t)}>
            {t}
          </ToggleChip>
        ))}
      </div>
      {custom.length > 0 ? (
        <div className="picker__chips" role="grid" aria-label="追加したタグ">
          {custom.map((t) => (
            <M3eInputChip
              key={t}
              removable
              removeLabel={`${t} を外す`}
              onRemove={() => onChange(value.filter((x) => x !== t))}
            >
              {t}
            </M3eInputChip>
          ))}
        </div>
      ) : null}
      <div className="picker__search">
        <M3eFormField variant="filled" className="field q__field" hideSubscript="always">
          <M3eIcon slot="prefix" name="sell" />
          <input
            id={`${id}-input`}
            className="input"
            value={text}
            maxLength={WORK_TAG_LENGTH_MAX}
            placeholder="ほかのタグを書いて Enter"
            aria-describedby={`${id}-hint`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(text);
              }
            }}
            onBlur={() => add(text)}
          />
        </M3eFormField>
      </div>
    </div>
  );
}

/** 押すたびに反転するチップ（role=button・aria-pressed）。選択は呼び出し側の値が正 */
function ToggleChip({
  selected,
  onToggle,
  children,
}: {
  selected: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const ref = useRef<M3eFilterChipElement>(null);
  const latest = useRef(selected);
  latest.current = selected;
  useEffect(() => {
    const chip = ref.current;
    if (!chip) return;
    const fix = () => {
      if (chip.getAttribute("role") !== "button") chip.setAttribute("role", "button");
      if (chip.hasAttribute("aria-checked")) chip.removeAttribute("aria-checked");
      const pressed = String(latest.current);
      if (chip.getAttribute("aria-pressed") !== pressed) chip.setAttribute("aria-pressed", pressed);
    };
    fix();
    const mo = new MutationObserver(fix);
    mo.observe(chip, {
      attributes: true,
      attributeFilter: ["role", "aria-checked", "aria-pressed"],
    });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    const chip = ref.current;
    if (!chip) return;
    chip.selected = selected;
    chip.setAttribute("aria-pressed", String(selected));
  }, [selected]);
  return (
    <M3eFilterChip
      ref={ref}
      selected={selected}
      onClick={() => {
        onToggle();
        // M3E が自分で反転させた分は、呼び出し側の値で上書きする
        requestAnimationFrame(() => {
          if (ref.current) ref.current.selected = latest.current;
        });
      }}
    >
      {children}
    </M3eFilterChip>
  );
}
