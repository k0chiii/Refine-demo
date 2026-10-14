import { api } from "@mf100/convex/api";
import { defaultRuleCategories, ruleSetPresets } from "@mf100/domain";
import { useQuery } from "convex/react";
import { Checkbox } from "@/ui/Field";
import { M3eFilterChip, M3eFilterChipSet } from "@/ui/m3e";

/**
 * 表記統一のカテゴリを制作物ごとに選ぶ。よく使う組み合わせ（プリセット）から選んでも、個別に選んでもよい。
 * 媒体・部署から自動では決めない（利用者が選ぶ）。未選択なら表記の検査をしない。
 */
export function CategoryPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const book = useQuery(api.notation.ruleBook, {});
  const categories = book?.categories ?? defaultRuleCategories;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const parentsOf = (code: string) => categories.find((c) => c.code === code)?.parents ?? [];
  const inherited = new Set(value.flatMap(parentsOf).filter((p) => !value.includes(p)));
  return (
    <fieldset className="category-picker">
      <legend className="category-picker__legend">表記統一のカテゴリ</legend>
      <M3eFilterChipSet aria-label="よく使う組み合わせ" className="category-picker__presets">
        {ruleSetPresets.map((p) => (
          <M3eFilterChip
            key={p.id}
            selected={same(value, p.categories)}
            onClick={() => onChange(same(value, p.categories) ? [] : [...p.categories])}
          >
            {p.label}
          </M3eFilterChip>
        ))}
      </M3eFilterChipSet>
      <div className="category-picker__list">
        {categories.map((c) => (
          <Checkbox
            key={c.code}
            checked={value.includes(c.code)}
            onChange={(on) => onChange(on ? [...value, c.code] : value.filter((x) => x !== c.code))}
            label={
              <>
                <b>{c.code}</b> {c.name}
                {inherited.has(c.code) ? <span className="muted small">（継承で適用）</span> : null}
              </>
            }
          />
        ))}
      </div>
      <p className="small muted">
        {value.length === 0
          ? "未選択のときは表記の検査をしません。"
          : "B・C・D は A1〜A3 の一般ルールも継承します。用途に近いカテゴリのルールが優先されます。"}
      </p>
    </fieldset>
  );
}
