import { QuestionHead } from "./Field";
import { useId, useState } from "react";
import {
  deadlineFromJst,
  deadlineToJst,
  formatDeadlineUntil,
  formatJstDate,
  formatJstShort,
  toJstDate,
} from "@/lib/format";
import {
  M3eDateInput,
  M3eDatepicker,
  M3eDatepickerToggle,
  M3eFormField,
  M3eIcon,
  M3eIconButton,
  M3eTimepicker,
  M3eTimepickerToggle,
} from "./m3e";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 締切・納期の入力（M3E date-input + date picker、任意で time-input + time picker）。
 *
 * 意味は domain の `deadlineFromJst`（利用者決定 2026-10-15）: 日付だけなら **その日の終わり**（値は翌日 0:00 JST の epoch ms。
 * 判定 `now < deadlineAt` で 23:59:59.999 まで受付）、時刻を入れたらその時刻で締め切る。
 * 入力欄の下に、確定する締切を「11/14（土）23:59 まで」と必ず出す（要件 §10-5）。
 * 表示・入力は JST の暦日・時刻として扱い、ブラウザのタイムゾーンに依存しないよう年月日と時分だけを受け渡す。
 */
export function DateField({
  label,
  value,
  onChange,
  required,
  hint,
  min,
  kind = "deadline",
}: {
  label: string;
  value: number | null;
  onChange: (epoch: number | null) => void;
  required?: boolean;
  hint?: string;
  /** この日より前の日付は選べない（epoch ms。その JST 暦日に丸める） */
  min?: number;
  /**
   * deadline（既定）: 締切・納期。日付だけなら「その日の 23:59 まで」と出す。
   * date: 入稿日などの日付。値の持ち方は同じ（日付だけなら翌日 0:00 JST）だが、「まで」とは書かない
   */
  kind?: "deadline" | "date";
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const pickerId = `${id}-picker`;
  const timeId = `${id}-time`;
  const timeLabelId = `${id}-time-label`;
  const timePickerId = `${id}-time-picker`;
  const summaryId = `${id}-summary`;
  const parts = value === null ? null : deadlineToJst(value);
  // 日付が空のあいだに入れた時刻は、日付が入るまでここで持つ
  const [pendingTime, setPendingTime] = useState<string | null>(null);
  const time = parts ? parts.time : pendingTime;

  /** YYYY-MM-DD → date-input の値（ローカルの Date。年月日だけを使う） */
  const toLocalDate = (date: string | null) =>
    date === null
      ? null
      : new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  const fromLocalDate = (d: Date | null) =>
    !d || Number.isNaN(d.getTime())
      ? null
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  /** HH:mm → time-input の値（ローカルの Date。時分だけを使う） */
  const toLocalTime = (t: string | null) =>
    t === null ? null : new Date(2000, 0, 1, Number(t.slice(0, 2)), Number(t.slice(3, 5)));
  const fromLocalTime = (d: Date | null) =>
    !d || Number.isNaN(d.getTime()) ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const minDate = min === undefined ? null : toJstDate(min);
  const emitDate = (e: Event) => {
    const date = fromLocalDate((e.target as unknown as { value: Date | null }).value);
    onChange(date === null ? null : deadlineFromJst(date, time));
  };
  const emitTime = (next: string | null) => {
    if (parts) onChange(deadlineFromJst(parts.date, next));
    else setPendingTime(next);
  };

  return (
    <>
      <div className="q">
        <QuestionHead
          htmlFor={inputId}
          labelId={`${id}-label`}
          label={label}
          required={required}
          hint={hint}
          hintId={`${id}-hint`}
        />
        <M3eFormField
          variant="filled"
          className="field q__field"
          hideSubscript="always"
          // 必須の印は質問文の赤い「*」だけ（M3E の印と二重にしない）
          hideRequiredMarker
        >
          <M3eDateInput
            id={inputId}
            type="date"
            aria-labelledby={`${id}-label`}
            aria-describedby={summaryId}
            value={toLocalDate(parts?.date ?? null)}
            {...(required ? { required: true } : {})}
            {...(minDate !== null ? { minDate: toLocalDate(minDate) } : {})}
            yearLabel="年"
            monthLabel="月"
            dayLabel="日"
            onChange={emitDate}
          />
          <M3eIconButton slot="suffix" aria-label="カレンダーから選ぶ">
            <M3eIcon name="calendar_today" />
            <M3eDatepickerToggle htmlFor={pickerId} />
          </M3eIconButton>
        </M3eFormField>
        {/* 時刻は任意（日付の下に置く。横に並べると幅で折り返しが変わり、入力のたびに形が跳ねる）。空ならその日の終わりまで */}
        <M3eFormField variant="filled" className="field q__field" hideSubscript="always">
          <label slot="label" id={timeLabelId} htmlFor={timeId}>
            時刻（任意）
          </label>
          <M3eDateInput
            id={timeId}
            type="time"
            timeFormat="24"
            aria-labelledby={`${id}-label ${timeLabelId}`}
            aria-describedby={summaryId}
            value={toLocalTime(time)}
            hourLabel="時"
            minuteLabel="分"
            onChange={(e) =>
              emitTime(fromLocalTime((e.target as unknown as { value: Date | null }).value))
            }
          />
          {time !== null ? (
            <M3eIconButton
              slot="suffix"
              aria-label="時刻を消す（その日の終わりまでにする）"
              onClick={() => emitTime(null)}
            >
              <M3eIcon name="close" />
            </M3eIconButton>
          ) : null}
          <M3eIconButton slot="suffix" aria-label="時刻を選ぶ">
            <M3eIcon name="schedule" />
            <M3eTimepickerToggle htmlFor={timePickerId} />
          </M3eIconButton>
        </M3eFormField>
        <p className="q__help" id={summaryId} aria-live="polite">
          {kind === "date"
            ? value === null
              ? "日付だけでも、時刻を付けてもよい"
              : time === null
                ? formatJstDate(value - 1)
                : formatJstShort(value)
            : value === null
              ? "時刻を入れなければ、その日の 23:59 までです"
              : time === null
                ? `${formatDeadlineUntil(value)}（時刻を入れるとその時刻で締め切ります）`
                : formatDeadlineUntil(value)}
        </p>
      </div>
      <M3eDatepicker
        id={pickerId}
        htmlFor={inputId}
        confirmLabel="決定"
        dismissLabel="キャンセル"
        previousMonthLabel="前の月"
        nextMonthLabel="次の月"
        previousYearLabel="前の年"
        nextYearLabel="次の年"
        onChange={emitDate}
      />
      <M3eTimepicker
        id={timePickerId}
        htmlFor={timeId}
        format="24"
        confirmLabel="決定"
        dismissLabel="キャンセル"
        hourLabel="時"
        minuteLabel="分"
        dialLabel="時刻を選ぶ"
        inputLabel="時刻を入力"
        modeToggleLabel="入力方法を切り替える"
      />
    </>
  );
}
