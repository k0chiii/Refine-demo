import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { M3eSelectElement } from "@m3e/web/select";
import { M3eCheckbox } from "@m3e/react/checkbox";
import { M3eFormField } from "@m3e/react/form-field";
import { M3eOption } from "@m3e/react/option";
import { M3eSelect } from "@m3e/react/select";

/**
 * フォーム部品。入力そのものは native の input / textarea を使う（日本語 IME・キーボード操作・ブラウザ標準の検証を優先: §4 デザイン）。
 * 選択は m3e-select + m3e-option、真偽は m3e-checkbox。
 *
 * 見た目は M3E の outlined form-field（枠付き・浮くラベル）。Google フォーム風の下線だけの入力（docs §30）は、
 * 利用者指示 2026-10-20「入力欄を M3E の枠付きに」で取りやめた（DECISIONS）。
 * ラベルは `slot="label"`、説明は `slot="hint"`、エラーは `slot="error"`。必須の印は M3E が入力の `required` から出す。
 *
 * `Field` が `useId` で生成した id を子の入力に渡す（label[for] と対応。説明は aria-describedby）。
 */
const FieldContext = createContext<{ id: string; labelId: string; hintId?: string } | null>(null);

/**
 * M3E form-field の subscript の出し方: 説明があれば常に出す / 無ければ畳む（エラーが出たときだけ現れる）。
 * （auto は「フォーカス中だけ」出る。説明は読み返せるよう常に出す）
 */
export const subscriptProps = (hasHint: boolean, error: boolean) =>
  error ? { error: true } : { hideSubscript: hasHint ? ("never" as const) : ("always" as const) };

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
  /** 入力側の `required` が必須の印（M3E が描く）の元。ここで指定すると入力にも `required` を足す */
  required?: boolean;
  className?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const control =
    required &&
    isValidElement<{ required?: boolean }>(children) &&
    children.type !== Fragment &&
    children.props.required !== true
      ? cloneElement(children, { required: true })
      : children;
  return (
    <FieldContext.Provider value={{ id, labelId, ...(hint ? { hintId } : {}) }}>
      <M3eFormField
        variant="outlined"
        className={`field ${className ?? ""}`}
        {...subscriptProps(Boolean(hint), Boolean(error))}
      >
        <label slot="label" htmlFor={id} id={labelId}>
          {label}
        </label>
        {control}
        {hint ? (
          <span slot="hint" id={hintId}>
            {hint}
          </span>
        ) : null}
        {error ? <span slot="error">{error}</span> : null}
      </M3eFormField>
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

/** 選択中の値を、順序と「未選択（空の値）」を除いた集合にそろえる（比較用） */
const selectionSet = (v: string | readonly string[] | null | undefined): string[] =>
  (Array.isArray(v) ? v : v == null ? [] : [v])
    .map(String)
    .filter((x) => x !== "")
    .sort();

const sameSelection = (a: string | readonly string[] | null, b: string | readonly string[]) => {
  const x = selectionSet(a);
  const y = selectionSet(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * M3E select を React の「制御された入力」として使うための土台（`Select` ・担当・小ジャンルが使う）。
 *
 * 素の `<M3eSelect value={…}>` には 2 つの罠があった（docs/UI_M3E.md）:
 * 1. `@lit/react` は React の再描画のたびに `value` を代入し直す。M3E は代入のたびに `_pendingValue` を作り直し、
 *    全 option を 1 つずつ非同期（await 付き）で `selected` に書き直す。フォームのどこか 1 文字を打つだけで
 *    画面中の全 select が選択し直しになり、選んだ直後の再描画では、選んだ値を古い値で上書きし得る。
 *    → 要素が持っている選択と違うときだけ代入する（普段は代入しない）。
 * 2. `multi` をプロパティで渡すと属性が付かず、M3E の option は「複数選択ではない」と判断して
 *    2 つ目を選ぶたびに 1 つ目の選択を外す（option の update が `hasAttribute("multi")` を見る）。
 *    → `multi` は属性で渡す。
 */
export function ControlledSelect({
  value,
  multi = false,
  onValueChange,
  children,
  ...rest
}: Omit<ComponentProps<typeof M3eSelect>, "value" | "multi" | "onChange"> & {
  value: string | readonly string[];
  multi?: boolean;
  /** 選ばれた値（単一選択でも配列。未選択は空配列）を返す */
  onValueChange: (values: string[]) => void;
}) {
  const ref = useRef<M3eSelectElement>(null);
  useLayoutEffect(() => {
    ref.current?.toggleAttribute("multi", multi);
  }, [multi]);
  // 描き直すたびに呼ぶ。要素の選択が state と同じなら何もしない
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !sameSelection(el.value, value)) el.value = multi ? [...selectionSet(value)] : value;
  });
  return (
    <M3eSelect
      ref={ref}
      {...rest}
      onChange={() => {
        const v = ref.current?.value;
        onValueChange(selectionSet(v).length === 0 ? [] : Array.isArray(v) ? v : [String(v)]);
      }}
    >
      {children}
    </M3eSelect>
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
 * 値の同期は {@link ControlledSelect}（`value` を描き直しのたびには代入しない）。
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
    <ControlledSelect
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
      onValueChange={(values) => onChange({ target: { value: values[0] ?? "" } })}
    >
      {options}
    </ControlledSelect>
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
