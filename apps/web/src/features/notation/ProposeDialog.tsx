import { api } from "@mf100/convex/api";
import { defaultRuleCategories } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useAction } from "@/lib/useAction";
import { Field, Select, TextArea, TextInput } from "@/ui/Field";
import { M3eButton, M3eButtonSegment, M3eDialog, M3eSegmentedButton } from "@/ui/m3e";
import { toast } from "@/lib/toast";

/**
 * 校正画面で選んだ文字から、表記ルールの追加を提案する（または誤表記として報告する）。
 * 選んだ文字・前後の文・制作物・版は自動で入る。承認されるまでルールには反映されない。
 * 文脈は、元の制作物を閲覧できない担当者には表示されない（サーバーで隠す）。
 */
export function ProposeDialog({
  open,
  onClose,
  quote,
  surrounding,
  workId,
  revisionId,
  artifactId,
  defaultCategory,
}: {
  open: boolean;
  onClose: () => void;
  quote: string;
  surrounding: string;
  workId: string;
  revisionId: string;
  artifactId: string;
  defaultCategory?: string;
}) {
  const book = useQuery(api.notation.ruleBook, open ? {} : "skip");
  const propose = useMutation(api.notation.propose);
  const [kind, setKind] = useState<"new" | "report">("new");
  const [category, setCategory] = useState(defaultCategory ?? "A2");
  const [correct, setCorrect] = useState("");
  const [incorrect, setIncorrect] = useState(quote);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    setIncorrect(quote);
    setCorrect("");
    setReason("");
    setKind("new");
  }, [open, quote]);
  const run = useAction(async () => {
    const r = await propose({
      kind,
      categoryCode: category,
      title: correct || incorrect,
      correct: correct ? [correct] : [],
      incorrect: incorrect ? [incorrect] : [],
      reason,
      context: { workId, revisionId, artifactId, quote, surrounding },
    });
    toast(
      r.merged
        ? "同じ内容の提案があったので、賛同として追加しました"
        : "提案を送りました。担当者が承認すると反映されます",
    );
    onClose();
  });
  const categories = book?.categories ?? defaultRuleCategories;
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる" dismissible>
      <span slot="header">表記ルールに提案</span>
      <div className="dialog-body">
        <p className="small muted">
          「{quote}」{surrounding ? `（${surrounding}）` : ""}
        </p>
        <M3eSegmentedButton aria-label="提案の種類">
          <M3eButtonSegment checked={kind === "new"} onClick={() => setKind("new")}>
            ルールの追加
          </M3eButtonSegment>
          <M3eButtonSegment checked={kind === "report"} onClick={() => setKind("report")}>
            誤表記の報告
          </M3eButtonSegment>
        </M3eSegmentedButton>
        <Field label="カテゴリ">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rule-editor__grid">
          <Field label="誤表記">
            <TextInput value={incorrect} onChange={(e) => setIncorrect(e.target.value)} />
          </Field>
          <Field
            label={kind === "new" ? "統一表記" : "正しいと思う表記（任意）"}
            required={kind === "new"}
          >
            <TextInput value={correct} onChange={(e) => setCorrect(e.target.value)} />
          </Field>
        </div>
        <Field label="理由（任意）">
          <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={run.pending || (kind === "new" ? !correct.trim() : !incorrect.trim())}
          onClick={() => void run.run()}
        >
          提案する
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
