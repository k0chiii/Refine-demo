import { api } from "@mf100/convex/api";
import { proofread, resolveRuleSet } from "@mf100/domain";
import type { FunctionReturnType } from "convex/server";
import { useDeferredValue, useMemo, useState } from "react";
import { Field, TextArea } from "@/ui/Field";
import { CategoryPicker } from "./CategoryPicker";
import { FindingList } from "./FindingList";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;

/** ルールを試す（ブラウザ内で検査。外部には送らない） */
export function RuleTester({ book }: { book: Book }) {
  const [text, setText] = useState(
    "去年の5月祭では、本郷の出し物にご参加頂きありがとうございました。お問合せは下記まで。",
  );
  const [cats, setCats] = useState<string[]>(["B"]);
  const deferred = useDeferredValue(text);
  const result = useMemo(() => {
    const rules = resolveRuleSet(book.categories, cats, book.rules, { year: 100 });
    return { rules: rules.length, ...proofread(deferred, rules) };
  }, [book, cats, deferred]);
  return (
    <div className="stack">
      <CategoryPicker value={cats} onChange={setCats} />
      <Field
        label="試す文章"
        hint={`適用されるルール ${result.rules} 件（MF100）・ブラウザ内で検査し、外部には送りません`}
      >
        <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {result.skipped.length ? (
        <p className="small error-text">
          使えないルール: {result.skipped.map((s) => `${s.ruleId}（${s.reason}）`).join("、")}
        </p>
      ) : null}
      {result.findings.length === 0 ? (
        <p className="small muted">確認箇所はありません</p>
      ) : (
        <FindingList label="試した結果" findings={result.findings} />
      )}
    </div>
  );
}
