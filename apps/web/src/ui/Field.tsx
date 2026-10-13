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
import { M3eCheckbox, M3eFormField, M3eOption, M3eSelect } from "./m3e";

/**
 * フォーム部品。外観は M3E の form-field（outlined）に任せ、入力そのものは native の
 * input / textarea を使う（日本語 IME・キーボード操作・ブラウザ標準の検証を優先: §4 デザイン）。
 * 選択は m3e-select + m3e-option、真偽は m3e-checkbox。
 *
 * `Field` が label / hint を slot に置き、`useId` で生成した id を子の入力に渡す（label[for] と対応）。
 */
const FieldContext = createContext<{ id: string; labelId: string } | null>(null);

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
  return (
    <FieldContext.Provider value={{ id, labelId }}>
      <M3eFormField
        variant="outlined"
        floatLabel="always"
        className={`field ${className ?? ""}`}
        {...(error ? { error: true } : {})}
        {...(required === undefined && !hint && !error ? { hideSubscript: "always" } : {})}
      >
        <label slot="label" htmlFor={id} id={labelId}>
          {label}
          {required ? <span className="field__required"> *</span> : null}
        </label>
        {children}
        {hint ? <span slot="hint">{hint}</span> : null}
        {error ? <span slot="error">{error}</span> : null}
      </M3eFormField>
    </FieldContext.Provider>
  );
}

function useFieldId(explicit: string | undefined) {
  const ctx = useContext(FieldContext);
  return explicit ?? ctx?.id ?? undefined;
}
function useFieldLabelId() {
  return useContext(FieldContext)?.labelId;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const id = useFieldId(props.id);
  return <input {...props} {...(id ? { id } : {})} className={`input ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useFieldId(props.id);
  return (
    <textarea
      rows={3}
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
