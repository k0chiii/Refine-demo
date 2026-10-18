import { Field, TextInput } from "@/ui/Field";
import { UserPicker } from "@/ui/UserPicker";
import { clampQuorum } from "./clampQuorum";

/**
 * 校了者（複数）と校了とみなす人数の入力。制作物の登録・編集と、一覧の「校了者」のセルで共通。
 * 校了者が 2 人以上のときだけ人数の欄を出す。
 */
export function ApproverFields({
  ids,
  quorum,
  onChange,
  required,
}: {
  ids: string[];
  /** 画面の値は文字列（入力中の空を許す） */
  quorum: string;
  onChange: (next: { ids: string[]; quorum: string }) => void;
  required?: boolean;
}) {
  return (
    <>
      <UserPicker
        label="校了者（校了権限者）"
        {...(required ? { required } : {})}
        value={ids}
        onChange={(next) =>
          onChange({
            ids: next,
            // 校了者を減らしたとき、人数が校了者の数を超えないようにする
            quorum: String(clampQuorum(quorum, next.length)),
          })
        }
      />
      {ids.length > 1 ? (
        <Field label="校了とみなす人数" hint={`1〜${ids.length} 人`}>
          <TextInput
            type="number"
            min={1}
            max={ids.length}
            step={1}
            inputMode="numeric"
            value={quorum}
            onChange={(e) => onChange({ ids, quorum: e.target.value })}
            onBlur={() => onChange({ ids, quorum: String(clampQuorum(quorum, ids.length)) })}
          />
        </Field>
      ) : null}
    </>
  );
}
