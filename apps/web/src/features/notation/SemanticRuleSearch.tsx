import { api } from "@mf100/convex/api";
import { useAction as useConvexAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { M3eButton } from "@m3e/react/button";
import { useAction } from "@/lib/useAction";
export function SemanticRuleSearch({ workId }: { workId: string }) {
  const search = useConvexAction(api.semanticRules.search);
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [rules, setRules] = useState<FunctionReturnType<typeof api.semanticRules.search> | null>(
    null,
  );
  const run = useAction(async () => {
    setRules(await search({ workId, text, consentToExternalSend: consent }));
  });
  return (
    <details>
      <summary>意味が近い表記ルールを探す</summary>
      <label>
        探したい内容
        <input value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        検索文を Cloudflare Workers AI に送ることに同意する
      </label>
      <M3eButton
        variant="outlined"
        disabled={!consent || !text.trim() || run.pending}
        onClick={() => void run.run()}
      >
        検索
      </M3eButton>
      {rules ? (
        <ul>
          {rules.map((rule) => (
            <li key={rule.ruleId}>
              {rule.title}（改訂 {rule.revision}）: {rule.correct.join(" / ")} — {rule.description}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
