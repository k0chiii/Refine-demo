import { Field, TextInput } from "@/ui/Field";
import { UserPicker } from "@/ui/UserPicker";
import { clampQuorum } from "./clampQuorum";

/**
 * 校了者（複数）と校了とみなす人数の入力。制作物の登録・編集と、一覧の「校了者」のセルで共通。
 * 校了者が 2 人以上のときだけ人数の欄を出す。制作者（excludeIds）は候補に出さない。
 */
export function ApproverFields({
  ids,
  quorum,
  onChange,
  required,
  excludeIds,
  readOnly,
}: {
  ids: string[];
  /** 画面の値は文字列（入力中の空を許す） */
  quorum: string;
  onChange: (next: { ids: string[]; quorum: string }) => void;
  required?: boolean;
  /** 校了者に選べない人（この制作物の制作者。利用者決定 2026-10-18「制作者が校了者になることはない」） */
  excludeIds?: readonly string[];
  /** 見るだけ（校了者を決める権限 approvers:assign が無い人。いまの校了者と人数を見せる） */
  readOnly?: boolean;
}) {
  return (
    <>
      <UserPicker
        label="校了者"
        {...(required && !readOnly ? { required } : {})}
        {...(readOnly ? { readOnly } : {})}
        value={ids}
        {...(excludeIds ? { exclude: [...excludeIds] } : {})}
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
            {...(readOnly ? { readOnly } : {})}
            onChange={(e) => onChange({ ids, quorum: e.target.value })}
            onBlur={() => onChange({ ids, quorum: String(clampQuorum(quorum, ids.length)) })}
          />
        </Field>
      ) : null}
    </>
  );
}
