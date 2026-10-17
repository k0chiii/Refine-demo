import { api } from "@mf100/convex/api";
import { sortTeams, type Team } from "@mf100/domain";
import { useQuery } from "convex/react";
import { Field, useFieldId, useFieldLabelId } from "@/ui/Field";
import { M3eOptGroup, M3eOption } from "@m3e/react/option";
import { M3eSelect } from "@m3e/react/select";

/**
 * 担当（局 › 担当）を選ぶ欄。M3E select（複数選択は `multi`）に、局ごとの option group で担当を並べる。
 * 局そのものも選べる（担当を持たない局・局全体で持つ制作物のため）。担当がまだ 1 件も無いときは欄を出さない。
 * 主管担当・制作担当は 1 つ（「なし」を選んで外せる。制作担当は利用者決定 2026-10-17）、関係担当は複数。
 */
export function TeamSelect({
  label,
  hint,
  value,
  onChange,
  multi,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  multi?: boolean;
}) {
  const teams = useQuery(api.teams.list, {});
  if (!teams || teams.length === 0) return null;
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <TeamOptions teams={teams} value={value} onChange={onChange} multi={multi === true} />
    </Field>
  );
}

function TeamOptions({
  teams,
  value,
  onChange,
  multi,
}: {
  teams: Team[];
  value: string[];
  onChange: (ids: string[]) => void;
  multi: boolean;
}) {
  const fieldId = useFieldId(undefined);
  const labelId = useFieldLabelId();
  const sorted = sortTeams(teams);
  const bureaus = sorted.filter((t) => t.kind === "bureau");
  return (
    <M3eSelect
      {...(fieldId ? { id: fieldId } : {})}
      {...(labelId ? { "aria-labelledby": labelId } : {})}
      className="select"
      {...(multi ? { multi: true } : {})}
      value={multi ? value : (value[0] ?? "")}
      onChange={(e) => {
        const v = (e.target as unknown as { value: string | readonly string[] | null }).value;
        const ids = (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is string => !!x);
        onChange(ids);
      }}
    >
      {multi ? null : <M3eOption value="">なし</M3eOption>}
      {bureaus.map((b) => (
        <M3eOptGroup key={b.id}>
          <span slot="label">{b.name}</span>
          <M3eOption value={b.id}>{b.name}（局全体）</M3eOption>
          {sorted
            .filter((t) => t.parentId === b.id)
            .map((t) => (
              <M3eOption key={t.id} value={t.id}>
                {t.name}
              </M3eOption>
            ))}
        </M3eOptGroup>
      ))}
    </M3eSelect>
  );
}
