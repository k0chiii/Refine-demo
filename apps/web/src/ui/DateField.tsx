import { QuestionHead } from "./Field";
import { useId, useMemo, useState } from "react";
import {
  deadlineFromJst,
  deadlineToJst,
  formatDeadlineUntil,
  formatJstDate,
  formatJstShort,
  toJstDate,
} from "@/lib/format";
import { M3eDateInput } from "@m3e/react/date-input";
import { M3eDatepicker, M3eDatepickerToggle } from "@m3e/react/datepicker";
import { M3eFormField } from "@m3e/react/form-field";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eSwitch } from "@m3e/react/switch";
import { M3eTimepicker, M3eTimepickerToggle } from "@m3e/react/timepicker";

const pad = (n: number) => String(n).padStart(2, "0");
/** 「時刻を指定」をオンにしたときの初めの時刻 */
const DEFAULT_TIME = "18:00";

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

/**
 * 締切・納期の入力（M3E date-input + date picker、スイッチ「時刻を指定」をオンにしたときだけ time-input + time picker）。
 *
 * 意味は domain の `deadlineFromJst`（利用者決定 2026-10-15）: 日付だけなら **その日の終わり**（値は翌日 0:00 JST の epoch ms。
 * 判定 `now < deadlineAt` で 23:59:59.999 まで受付）、時刻を入れたらその時刻で締め切る。
 * スイッチはまずオフ（時刻があるときだけオン）。オフにすると時刻を消す（= その日の終わり）、オンにすると 18:00 から始める
 * （利用者指示 2026-10-18「時刻表示は、まずオンオフボタンで切り替え、時刻がある時だけ入力にしたい」）。
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
  const switchId = `${id}-time-switch`;
  const timePickerId = `${id}-time-picker`;
  const summaryId = `${id}-summary`;
  const parts = value === null ? null : deadlineToJst(value);
  // 日付が空のあいだに入れた時刻は、日付が入るまでここで持つ
  const [pendingTime, setPendingTime] = useState<string | null>(null);
  const time = parts ? parts.time : pendingTime;
  // 時刻の入力を出すかどうか。時刻があるあいだは必ずオン（外から値が入ったときも）。オンにして時刻がまだ空の間もオンのまま
  const [timeOn, setTimeOn] = useState(time !== null);
  const showTime = timeOn || time !== null;

  const minDate = min === undefined ? null : toJstDate(min);
  // M3E の date-input には Date オブジェクトを渡す。毎回 new Date すると、@lit/react が描き直しのたびに「値が変わった」と
  // 見て、フォームのどこを操作しても全部の日付欄が更新される（入力途中の年月日も巻き込む）。日付が同じなら同じ Date を渡す
  const dateValue = useMemo(() => toLocalDate(parts?.date ?? null), [parts?.date]);
  const timeValue = useMemo(() => toLocalTime(time), [time]);
  const minValue = useMemo(() => (minDate === null ? null : toLocalDate(minDate)), [minDate]);
  const emitDate = (e: Event) => {
    const date = fromLocalDate((e.target as unknown as { value: Date | null }).value);
    onChange(date === null ? null : deadlineFromJst(date, time));
  };
  const emitTime = (next: string | null) => {
    if (parts) onChange(deadlineFromJst(parts.date, next));
    else setPendingTime(next);
  };
  const switchTime = (on: boolean) => {
    setTimeOn(on);
    emitTime(on ? DEFAULT_TIME : null);
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
            value={dateValue}
            {...(required ? { required: true } : {})}
            {...(minValue !== null ? { minDate: minValue } : {})}
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
        {/* 時刻はスイッチで指定したときだけ入力を出す（日付の下に置く。横に並べると幅で折り返しが変わり、入力のたびに形が跳ねる）。オフならその日の終わりまで */}
        <span className="checkbox">
          <M3eSwitch
            id={switchId}
            aria-labelledby={`${switchId}-label`}
            {...(showTime ? { "aria-controls": timeId } : {})}
            checked={showTime}
            onChange={(e) => switchTime((e.target as unknown as { checked: boolean }).checked)}
          />
          <label htmlFor={switchId} id={`${switchId}-label`}>
            時刻を指定
          </label>
        </span>
        {showTime ? (
          <M3eFormField variant="filled" className="field q__field" hideSubscript="always">
            <label slot="label" id={timeLabelId} htmlFor={timeId}>
              時刻
            </label>
            <M3eDateInput
              id={timeId}
              type="time"
              timeFormat="24"
              aria-labelledby={`${id}-label ${timeLabelId}`}
              aria-describedby={summaryId}
              value={timeValue}
              hourLabel="時"
              minuteLabel="分"
              onChange={(e) =>
                emitTime(fromLocalTime((e.target as unknown as { value: Date | null }).value))
              }
            />
            <M3eIconButton slot="suffix" aria-label="時刻を選ぶ">
              <M3eIcon name="schedule" />
              <M3eTimepickerToggle htmlFor={timePickerId} />
            </M3eIconButton>
          </M3eFormField>
        ) : null}
        <p className="q__help" id={summaryId} aria-live="polite">
          {kind === "date"
            ? value === null
              ? "日付だけでも、時刻を付けてもよい"
              : time === null
                ? formatJstDate(value - 1)
                : formatJstShort(value)
            : value === null
              ? "日付だけでも、時刻を付けてもよい"
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
      {showTime ? (
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
      ) : null}
    </>
  );
}
