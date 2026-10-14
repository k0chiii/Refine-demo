import { ruleStrictnessLabels, type Finding } from "@mf100/domain";
import type { ReactNode } from "react";
import { M3eIcon, M3eList, M3eListItem } from "@/ui/m3e";

/**
 * 表記の指摘の一覧（M3E list）。1 件 = 3 行のリスト項目:
 * overline に厳格さとルール、見出しに「誤 → 正」、補足に理由と例外。操作は trailing に置く。
 */
export function FindingList<F extends Finding>({
  findings,
  actions,
  label,
}: {
  findings: readonly F[];
  actions?: (f: F) => ReactNode;
  label: string;
}) {
  return (
    <M3eList className="finding-list" aria-label={label}>
      {findings.map((f, i) => (
        <M3eListItem
          key={`${f.fingerprint}-${i}`}
          className={`finding ${f.needsReview ? "finding--review" : ""}`}
        >
          <M3eIcon
            slot="leading"
            name={f.needsReview ? "help" : "spellcheck"}
            className="finding__icon"
            aria-hidden="true"
          />
          <span slot="overline">
            {f.needsReview ? "要確認" : ruleStrictnessLabels[f.strictness]}・{f.ruleId} 版{" "}
            {f.ruleRevision}
          </span>
          <span>
            <span className="finding__orig">{f.original}</span>
            <span aria-hidden="true"> → </span>
            <span className="finding__sugg">{f.suggestion || "（候補なし）"}</span>
          </span>
          <span slot="supporting-text">
            {f.reason || f.title}
            {f.exceptionNote ? `（例外: ${f.exceptionNote}）` : ""}
          </span>
          {actions ? (
            <span slot="trailing" className="finding__actions">
              {actions(f)}
            </span>
          ) : null}
        </M3eListItem>
      ))}
    </M3eList>
  );
}
