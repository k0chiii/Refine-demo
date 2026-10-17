import { api } from "@mf100/convex/api";
import { workStatsToCsv } from "@mf100/domain";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { TeamSelect } from "./TeamSelect";

// 押したときだけ読む（null の間は読まない。"" はすべて）
const useStats = (teamId: string | null) =>
  useQuery(api.admin.workStats, teamId === null ? "skip" : teamId ? { teamId } : {});

/**
 * 管理 › 制作物 › 集計を書き出す（利用者決定 2026-10-15 A-4: 制度の試行の前後を比べるため。管理者だけ）。
 * 担当で絞れる（局を選ぶとその局の担当すべて）。書き出しは手元に保存するだけで、外へは送らない。
 */
export function ExportStatsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [team, setTeam] = useState<string[]>([]);
  const [requested, setRequested] = useState<string | null>(null);
  const rows = useStats(requested);
  useEffect(() => {
    if (requested === null || rows === undefined) return;
    // 列と書き方は domain の workStatsToCsv（見出しは日本語）。Excel で開けるよう BOM を付ける
    const blob = new Blob(["\uFEFF", workStatsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `制作物の集計_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${rows.length} 件の制作物を書き出しました`);
    setRequested(null);
    onClose();
  }, [rows, requested]);

  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">集計を CSV で書き出す</span>
      <div className="dialog-body">
        <p className="small muted">
          制作物ごとに、版の数・提出から校了までの日数・コメント数（版ごと）・不採用と持ち越しの件数と理由・フィードバックのスレッドと投稿の数を書き出します。
        </p>
        <TeamSelect label="担当で絞る（なしならすべて）" value={team} onChange={setTeam} />
      </div>
      <div slot="actions" className="row">
        <span className="spacer" />
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={requested !== null}
          onClick={() => setRequested(team[0] ?? "")}
        >
          <M3eIcon slot="icon" name="download" />
          書き出す
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
