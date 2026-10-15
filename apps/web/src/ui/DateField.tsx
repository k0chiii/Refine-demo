import { useId } from "react";
import { epochToJstLocal, jstDateToEpoch } from "@/lib/format";
import {
  M3eDateInput,
  M3eDatepicker,
  M3eDatepickerToggle,
  M3eFormField,
  M3eIcon,
  M3eIconButton,
} from "./m3e";

/**
 * 日付入力（M3E date-input + date picker）。時刻は持たず、値はその日の **0:00 JST** の epoch ms。
 * 表示・入力は JST の暦日として扱い、ブラウザのタイムゾーンに依存しないよう年月日だけを受け渡す。
 */
export function DateField({
  label,
  value,
  onChange,
  required,
  hint,
  min,
}: {
  label: string;
  value: number | null;
  onChange: (epoch: number | null) => void;
  required?: boolean;
  hint?: string;
  /** この日より前は選べない（epoch ms。その日の 0:00 JST に丸める） */
  min?: number;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const pickerId = `${id}-picker`;
  const toLocalDate = (epoch: number | null) => {
    if (epoch === null) return null;
    const s = epochToJstLocal(epoch); // YYYY-MM-DDTHH:mm（JST）
    return new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  };
  const fromLocalDate = (d: Date | null) => {
    if (!d || Number.isNaN(d.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return jstDateToEpoch(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };
  const emit = (e: Event) =>
    onChange(fromLocalDate((e.target as unknown as { value: Date | null }).value));
  return (
    <>
      <M3eFormField
        variant="outlined"
        floatLabel="always"
        className="field"
        {...(!hint ? { hideSubscript: "always" } : {})}
        // 必須の印は自前の赤い「*」だけ（M3E の印と二重にしない）
        hideRequiredMarker
      >
        <label slot="label" htmlFor={inputId} id={`${id}-label`}>
          {label}
          {required ? <span className="field__required"> *</span> : null}
        </label>
        <M3eDateInput
          id={inputId}
          type="date"
          aria-labelledby={`${id}-label`}
          value={toLocalDate(value)}
          {...(required ? { required: true } : {})}
          {...(min !== undefined ? { minDate: toLocalDate(min) } : {})}
          yearLabel="年"
          monthLabel="月"
          dayLabel="日"
          onChange={emit}
        />
        <M3eIconButton slot="suffix" aria-label="カレンダーから選ぶ">
          <M3eIcon name="calendar_today" />
          <M3eDatepickerToggle htmlFor={pickerId} />
        </M3eIconButton>
        {hint ? <span slot="hint">{hint}</span> : null}
      </M3eFormField>
      <M3eDatepicker
        id={pickerId}
        htmlFor={inputId}
        confirmLabel="決定"
        dismissLabel="キャンセル"
        previousMonthLabel="前の月"
        nextMonthLabel="次の月"
        previousYearLabel="前の年"
        nextYearLabel="次の年"
        onChange={emit}
      />
    </>
  );
}
