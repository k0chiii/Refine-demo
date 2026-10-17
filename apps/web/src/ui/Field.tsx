import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { M3eCheckbox } from "@m3e/react/checkbox";
import { M3eFormField } from "@m3e/react/form-field";
import { M3eOption } from "@m3e/react/option";
import { M3eSelect } from "@m3e/react/select";

/**
 * フォーム部品。入力そのものは native の input / textarea を使う（日本語 IME・キーボード操作・ブラウザ標準の検証を優先: §4 デザイン）。
 * 選択は m3e-select + m3e-option、真偽は m3e-checkbox。
 *
 * 見た目は Google フォームの「質問」に合わせる（利用者指示 2026-10-15「入力欄や editor in card が多く見える」）:
 * 質問文（ラベル）を上に普通の文字で置き、説明（hint）をその下に、入力は枠のない下線だけ（M3E form-field の filled を
 * 背景なし・角なしにしたもの）。枠の中に枠が並ばないようにする。
 *
 * `Field` が `useId` で生成した id を子の入力に渡す（label[for] と対応。説明は aria-describedby）。
 */
const FieldContext = createContext<{ id: string; labelId: string; hintId?: string } | null>(null);

/** 質問文と説明（Field・DateField・UserPicker で共通） */
export function QuestionHead({
  htmlFor,
  labelId,
  label,
  required,
  hint,
  hintId,
}: {
  htmlFor: string;
  labelId: string;
  label: ReactNode;
  required?: boolean | undefined;
  hint?: string | undefined;
  hintId?: string | undefined;
}) {
  return (
    <>
      <label className="q__title" htmlFor={htmlFor} id={labelId}>
        {label}
        {required ? <span className="field__required"> *</span> : null}
      </label>
      {hint ? (
        <p className="q__help" id={hintId}>
          {hint}
        </p>
      ) : null}
    </>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
  className,
}: {
  label: string;
  hint?: string;
  /** 指定するとフィールドをエラー表示にし、subscript にこの文言を出す */
  error?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <FieldContext.Provider value={{ id, labelId, ...(hint ? { hintId } : {}) }}>
      <div className={`q ${className ?? ""}`}>
        <QuestionHead
          htmlFor={id}
          labelId={labelId}
          label={label}
          required={required}
          hint={hint}
          hintId={hintId}
        />
        <M3eFormField
          variant="filled"
          className="field q__field"
          {...(error ? { error: true } : { hideSubscript: "always" })}
          // 必須の印は質問文の赤い「*」だけ（M3E の印と二重にしない）
          hideRequiredMarker
        >
          {children}
          {error ? <span slot="error">{error}</span> : null}
        </M3eFormField>
      </div>
    </FieldContext.Provider>
  );
}

export function useFieldId(explicit: string | undefined) {
  const ctx = useContext(FieldContext);
  return explicit ?? ctx?.id ?? undefined;
}
export function useFieldLabelId() {
  return useContext(FieldContext)?.labelId;
}
function useFieldHintId() {
  return useContext(FieldContext)?.hintId;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const id = useFieldId(props.id);
  const hintId = useFieldHintId();
  return (
    <input
      {...(hintId ? { "aria-describedby": hintId } : {})}
      {...props}
      {...(id ? { id } : {})}
      className={`input ${props.className ?? ""}`}
    />
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useFieldId(props.id);
  const hintId = useFieldHintId();
  return (
    <textarea
      rows={3}
      {...(hintId ? { "aria-describedby": hintId } : {})}
      {...props}
      {...(id ? { id } : {})}
      className={`input input--area ${props.className ?? ""}`}
    />
  );
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value"
> {
  value: string;
  /** native select と同じ形（e.target.value）で値を返す */
  onChange: (e: { target: { value: string } }) => void;
}

/**
 * `<option value>…</option>` の子を受け取り m3e-option に写す（既存の呼び出し側を変えない）。
 * 値は m3e-select の `value` プロパティに同期する。
 */
export function Select({
  value,
  onChange,
  children,
  disabled,
  required,
  id,
  ...rest
}: SelectProps) {
  const fieldId = useFieldId(id);
  const labelId = useFieldLabelId();
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child))
      return [];
    const v = String(child.props.value ?? "");
    return [
      <M3eOption key={v} value={v} {...(child.props.disabled ? { disabled: true } : {})}>
        {child.props.children}
      </M3eOption>,
    ];
  });
  return (
    <M3eSelect
      {...(fieldId ? { id: fieldId } : {})}
      {...(disabled ? { disabled: true } : {})}
      {...(required ? { required: true } : {})}
      {...(rest["aria-label"]
        ? { "aria-label": rest["aria-label"] }
        : labelId
          ? { "aria-labelledby": labelId }
          : {})}
      className={`select ${rest.className ?? ""}`}
      value={value}
      onChange={(e) => {
        const v = (e.target as unknown as { value: string | readonly string[] | null }).value;
        onChange({ target: { value: Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "") } });
      }}
    >
      {options}
    </M3eSelect>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  id?: string;
  disabled?: boolean;
}) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <span className="checkbox">
      <M3eCheckbox
        id={cid}
        aria-labelledby={`${cid}-label`}
        checked={checked}
        {...(disabled ? { disabled: true } : {})}
        onChange={(e) => onChange((e.target as unknown as { checked: boolean }).checked)}
      />
      <label htmlFor={cid} id={`${cid}-label`}>
        {label}
      </label>
    </span>
  );
}
