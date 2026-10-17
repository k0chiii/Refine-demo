import type { ManualPair } from "@mf100/domain";
import { useEffect, useState } from "react";
import { describeError } from "@/lib/errors";
import { Field, Select } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import type { PdfComparison } from "./useComparison";

const confidenceLabel = { high: "高", medium: "中", low: "低" } as const;
/** m3e-select は空文字の値を表示できないので、対応なしは専用の値にする */
const NONE = "none";

/**
 * ページ対応の確認と手動修正（版比較 §2.1）。新版の各ページに旧版のどのページが対応するかを選ぶ。
 * 保存した対応は同じ添付の組で再利用し、「自動に戻す」で消せる。指摘の座標は変えない。
 */
export function PageMappingDialog({
  open,
  pdf,
  leftLabel,
  rightLabel,
  onClose,
}: {
  open: boolean;
  pdf: PdfComparison;
  leftLabel: string;
  rightLabel: string;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const next: Record<number, string> = {};
    for (let r = 1; r <= pdf.rightCount; r++) {
      const p = pdf.pairs.find((x) => x.right === r);
      next[r] = p?.left ? String(p.left) : NONE;
    }
    setSel(next);
    setError(null);
  }, [open, pdf.pairs, pdf.rightCount]);
  const used = Object.values(sel).filter((v) => v && v !== NONE);
  const dup = used.length !== new Set(used).size;
  const save = async (pairs: ManualPair[]) => {
    setSaving(true);
    setError(null);
    try {
      await pdf.saveManual(pairs);
      onClose();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setSaving(false);
    }
  };
  const buildPairs = (): ManualPair[] => {
    const pairs: ManualPair[] = [];
    for (let r = 1; r <= pdf.rightCount; r++)
      pairs.push({ left: sel[r] && sel[r] !== NONE ? Number(sel[r]) : null, right: r });
    const chosen = new Set(used.map(Number));
    for (let l = 1; l <= pdf.leftCount; l++)
      if (!chosen.has(l)) pairs.push({ left: l, right: null });
    return pairs;
  };
  const unmatchedLeft = Array.from({ length: pdf.leftCount }, (_, i) => i + 1).filter(
    (l) => !used.includes(String(l)),
  );
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">ページの対応</span>
      <div className="dialog-body mapping">
        <p className="small muted" style={{ margin: 0 }}>
          {rightLabel} の各ページに、{leftLabel}{" "}
          のどのページが対応するかを選びます。自動の推定（文字と縮小画像の類似度）を直すと、同じ版の組で次回も使われます。
        </p>
        <ul className="mapping__list">
          {Array.from({ length: pdf.rightCount }, (_, i) => i + 1).map((r) => {
            const auto = pdf.autoPairs.find((x) => x.right === r);
            return (
              <li key={r} className="mapping__row">
                <span className="mapping__page">
                  {rightLabel} {r} ページ
                  <span className="small muted">
                    {auto?.left
                      ? `自動: ${auto.left} ページ（信頼度 ${confidenceLabel[auto.confidence]}）`
                      : "自動: 対応なし"}
                  </span>
                </span>
                <Field label={`${leftLabel}のページ`}>
                  <Select
                    value={sel[r] ?? NONE}
                    onChange={(e) => setSel((s) => ({ ...s, [r]: e.target.value }))}
                  >
                    <option value={NONE}>対応なし（追加ページ）</option>
                    {Array.from({ length: pdf.leftCount }, (_, k) => k + 1).map((l) => (
                      <option key={l} value={String(l)}>
                        {l} ページ
                      </option>
                    ))}
                  </Select>
                </Field>
              </li>
            );
          })}
        </ul>
        {unmatchedLeft.length > 0 ? (
          <p className="small muted" style={{ margin: 0 }}>
            {leftLabel} の {unmatchedLeft.join("・")} ページは新版に対応なし（削除）として扱います
          </p>
        ) : null}
        {dup ? <p className="small error-text">同じページを 2 回選んでいます</p> : null}
        {error ? <p className="small error-text">{error}</p> : null}
        {pdf.manual.length > 0 ? (
          <M3eButton variant="text" disabled={saving} onClick={() => void save([])}>
            自動の対応に戻す
          </M3eButton>
        ) : null}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={dup || saving}
          onClick={() => void save(buildPairs())}
        >
          保存
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
