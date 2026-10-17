import { api } from "@mf100/convex/api";
import type { Finding } from "@mf100/domain";
import { useAction as useConvexAction, useQuery } from "convex/react";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eCircularProgressIndicator } from "@m3e/react/progress-indicator";
import { FindingList } from "./FindingList";

/**
 * 任意の AI 校正。押したときだけ、送り先を確かめてから文章を送る。結果は候補（要確認）だけで、
 * 反映は利用者が 1 件ずつ選ぶ。使えないとき（キー未設定・非公開の制作物）は理由だけを出す。
 */
export function AiAssist({
  workId,
  getText,
  onApply,
  readOnly,
}: {
  workId: string;
  getText: () => string;
  onApply: (f: Finding) => void;
  readOnly: boolean;
}) {
  const status = useQuery(api.ai.status, { workId });
  const proofread = useConvexAction(api.ai.proofread);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{
    candidates: Finding[];
    provider: string;
    note: string | null;
  } | null>(null);
  const run = useAction(async () => {
    setConfirm(false);
    const r = await proofread({ workId, text: getText() });
    setResult({ candidates: r.candidates, provider: r.provider, note: r.blocked });
  });
  if (!status) return null;
  // 使えないとき（API キー未設定など）は何も出さない（地の文で状態を並べない）
  if (!status.available) return null;
  const chars = getText().length;
  return (
    <div className="stack ai-assist">
      {/* 処理中はボタンの文言を変えず、無効にして横に進捗と状態を出す（M3 Content design: ボタンは操作の名前のまま） */}
      <div className="row">
        <M3eButton
          variant="outlined"
          disabled={run.pending || chars === 0}
          onClick={() => setConfirm(true)}
        >
          <M3eIcon slot="icon" name="auto_awesome" />
          AI に校正の候補を出してもらう
        </M3eButton>
        {run.pending ? (
          <span className="row small muted" role="status">
            <M3eCircularProgressIndicator indeterminate aria-label="AI が確認しています" />
            AI が確認しています
          </span>
        ) : null}
      </div>
      {result ? (
        result.note ? (
          <p className="small error-text">{result.note}</p>
        ) : result.candidates.length === 0 ? (
          <p className="small muted">AI（{result.provider}）の候補はありません</p>
        ) : (
          <>
            <p className="small muted">
              AI（{result.provider}）の候補 {result.candidates.length}{" "}
              件。誤りと決まったものではありません。
            </p>
            <FindingList
              label="AI の候補"
              findings={result.candidates}
              actions={(f) => (
                <>
                  {!readOnly && f.suggestion ? (
                    <M3eIconButton
                      aria-label={`「${f.suggestion}」に修正`}
                      title="修正"
                      onClick={() => {
                        onApply(f);
                        setResult(
                          (r) => r && { ...r, candidates: r.candidates.filter((x) => x !== f) },
                        );
                      }}
                    >
                      <M3eIcon name="check" />
                    </M3eIconButton>
                  ) : null}
                  <M3eIconButton
                    aria-label="この候補を閉じる"
                    onClick={() =>
                      setResult(
                        (r) => r && { ...r, candidates: r.candidates.filter((x) => x !== f) },
                      )
                    }
                  >
                    <M3eIcon name="close" />
                  </M3eIconButton>
                </>
              )}
            />
          </>
        )
      ) : null}
      <M3eDialog open={confirm} onClosed={() => setConfirm(false)} closeLabel="閉じる">
        <span slot="header">外部の AI に送ります</span>
        <div className="dialog-body">
          <p>
            この文章（{chars} 文字）と表記ルールを {status.provider}{" "}
            に送り、校正の候補を受け取ります。
            候補は保存されず、ルールやコメントが自動で変わることはありません。
          </p>
          <p className="small muted">
            送信の記録（誰が・いつ・文字数）は監査ログに残ります。送り先の利用規約に従って扱われます。
          </p>
        </div>
        <div slot="actions" className="row">
          <M3eButton variant="text" onClick={() => setConfirm(false)}>
            キャンセル
          </M3eButton>
          <M3eButton variant="filled" onClick={() => void run.run()}>
            送信する
          </M3eButton>
        </div>
      </M3eDialog>
    </div>
  );
}
