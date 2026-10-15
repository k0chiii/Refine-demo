import { api } from "@mf100/convex/api";
import {
  previewCsvImport,
  previewJsonImport,
  type ImportPreview,
  type RuleDraft,
} from "@mf100/domain";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { useAction } from "@/lib/useAction";
import { DataTable } from "@/ui/DataTable";
import { Checkbox, Field, TextInput } from "@/ui/Field";
import {
  M3eAccordion,
  M3eButton,
  M3eChip,
  M3eChipSet,
  M3eDialog,
  M3eExpansionPanel,
  M3eIcon,
  M3eList,
  M3eListItem,
} from "@/ui/m3e";
import { toast } from "@/lib/toast";

type Book = FunctionReturnType<typeof api.notation.ruleBook>;

const CHUNK = 400;

/**
 * 取り込み（CSV: MF99 スプレッドシート / JSON: notation2・MF100 の書き出し）。
 * 読み込んだらまずプレビュー（ルール・説明行・警告・重複・矛盾）を出し、確認してから取り込む。
 * ルールにできない説明行はカテゴリの運用メモへ入れる（機械的にルール化しない）。
 */
export function ImportDialog({
  book,
  open,
  onClose,
}: {
  book: Book;
  open: boolean;
  onClose: () => void;
}) {
  const importBatch = useMutation(api.notation.importBatch);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [year, setYear] = useState("100");
  const [overwrite, setOverwrite] = useState(false);
  const [raw, setRaw] = useState<{ kind: "csv" | "json"; text: string } | null>(null);
  const existing: RuleDraft[] = book.rules;
  const fileRef = useRef<HTMLInputElement>(null);

  const build = (r: { kind: "csv" | "json"; text: string }, y: number) => {
    try {
      setPreview(
        r.kind === "csv"
          ? previewCsvImport(r.text, { defaultYear: y, existing })
          : previewJsonImport(JSON.parse(r.text), { defaultYear: y, existing }),
      );
    } catch (e) {
      setPreview({
        rules: [],
        notes: [],
        warnings: [
          { line: 0, message: `読み込めません: ${e instanceof Error ? e.message : String(e)}` },
        ],
        duplicates: [],
        conflicts: [],
      });
    }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) {
      toast("5MB までのファイルを選んでください", { kind: "warning" });
      return;
    }
    const text = await f.text();
    const kind =
      /\.json$/i.test(f.name) ||
      text.trimStart().startsWith("{") ||
      text.trimStart().startsWith("[")
        ? "json"
        : "csv";
    setFileName(f.name);
    setRaw({ kind, text });
    build({ kind, text }, Number(year) || 100);
  };
  const existingIds = new Set(book.rules.map((r) => r.ruleId));
  const editable = (code: string) => (book.roles[code] ?? "member") !== "member";
  const blocked = preview ? preview.rules.filter((r) => !editable(r.categoryCode)) : [];

  const run = useAction(async () => {
    if (!preview) return;
    const rules = preview.rules.filter((r) => editable(r.categoryCode));
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (let i = 0; i < Math.max(1, rules.length); i += CHUNK) {
      const res = await importBatch({
        rules: rules.slice(i, i + CHUNK),
        notes:
          i === 0 ? preview.notes.map((n) => ({ categoryCode: n.categoryCode, text: n.text })) : [],
        overwrite,
        reason: `取り込み: ${fileName}`,
      });
      created += res.created;
      updated += res.updated;
      skipped += res.skipped;
      errors.push(...res.errors.map((e) => `${e.ruleId}: ${e.errors.join("、")}`));
    }
    toast(
      `追加 ${created}・更新 ${updated}・既存のため除外 ${skipped}${errors.length ? `・失敗 ${errors.length}` : ""}`,
    );
    if (!errors.length) close();
  });
  const close = () => {
    setPreview(null);
    setRaw(null);
    setFileName("");
    onClose();
  };

  return (
    <M3eDialog open={open} onClosed={close} closeLabel="閉じる" className="dialog--full">
      <span slot="header">ルールを取り込む</span>
      <div className="dialog-body stack">
        <p className="small muted">
          CSV（表記統一スプレッドシート）か
          JSON（この画面の書き出し・notation2）を選びます。取り込む前に内容を確認できます。MF100
          が正本なので、旧年度のルールには年度を付けて取り込み、MF100 に無条件では当てません。
        </p>
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <M3eButton variant="outlined" onClick={() => fileRef.current?.click()}>
            <M3eIcon slot="icon" name="upload_file" />
            ファイルを選ぶ
          </M3eButton>
          <span className="small">{fileName}</span>
          <span className="spacer" />
          <Field label="年度の指定が無い行の年度" className="field--narrow">
            <TextInput
              inputMode="numeric"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                if (raw) build(raw, Number(e.target.value) || 100);
              }}
            />
          </Field>
        </div>
        {preview ? (
          <>
            <M3eChipSet aria-label="取り込みの内容" className="import-summary">
              <M3eChip>ルール {preview.rules.length}</M3eChip>
              <M3eChip>
                既存の ID {preview.rules.filter((r) => existingIds.has(r.ruleId)).length}
              </M3eChip>
              <M3eChip>説明行 {preview.notes.length}</M3eChip>
              <M3eChip>警告 {preview.warnings.length}</M3eChip>
              <M3eChip>重複 {preview.duplicates.length}</M3eChip>
              <M3eChip className={preview.conflicts.length ? "chip--error" : ""}>
                矛盾 {preview.conflicts.length}
              </M3eChip>
              {blocked.length ? (
                <M3eChip
                  className="chip--error"
                  title={`権限の無いカテゴリ（${Array.from(new Set(blocked.map((r) => r.categoryCode))).join("・")}）のルールは取り込みません`}
                >
                  権限なしで除外 {blocked.length}
                </M3eChip>
              ) : null}
            </M3eChipSet>
            <M3eAccordion multi className="import-details">
              {preview.conflicts.length ? (
                <M3eExpansionPanel open>
                  <span slot="header">
                    矛盾（同じ誤表記に別の統一表記）{preview.conflicts.length}
                  </span>
                  <M3eList>
                    {preview.conflicts.map((c) => (
                      <M3eListItem key={c.key}>
                        {c.key.replace(/^\w+:/, "")} → {c.corrects.join(" / ")}
                        <span slot="supporting-text">{c.ruleIds.join(", ")}</span>
                      </M3eListItem>
                    ))}
                  </M3eList>
                </M3eExpansionPanel>
              ) : null}
              {preview.warnings.length ? (
                <M3eExpansionPanel>
                  <span slot="header">警告 {preview.warnings.length}</span>
                  <M3eList>
                    {preview.warnings.slice(0, 200).map((w, i) => (
                      <M3eListItem key={i}>
                        {w.message}
                        {w.line ? <span slot="supporting-text">{w.line} 行目</span> : null}
                      </M3eListItem>
                    ))}
                  </M3eList>
                </M3eExpansionPanel>
              ) : null}
              {preview.notes.length ? (
                <M3eExpansionPanel>
                  <span slot="header">
                    説明行（カテゴリの運用メモに入れます）{preview.notes.length}
                  </span>
                  <M3eList>
                    {preview.notes.slice(0, 200).map((n, i) => (
                      <M3eListItem key={i}>
                        {n.text}
                        <span slot="supporting-text">
                          {n.categoryCode}・{n.line} 行目
                        </span>
                      </M3eListItem>
                    ))}
                  </M3eList>
                </M3eExpansionPanel>
              ) : null}
              <M3eExpansionPanel open>
                <span slot="header">取り込むルール {preview.rules.length}</span>
                <DataTable
                  label="取り込むルール"
                  rows={preview.rules}
                  defaultSort={{ key: "id", dir: 1 }}
                  rowKey={(r) => r.ruleId}
                  columns={[
                    {
                      key: "id",
                      header: "ID",
                      rowHeader: true,
                      sort: (a, b) => a.ruleId.localeCompare(b.ruleId),
                      cell: (r) => <span className="small">{r.ruleId}</span>,
                    },
                    {
                      key: "cat",
                      header: "カテゴリ",
                      sort: (a, b) => a.categoryCode.localeCompare(b.categoryCode),
                      cell: (r) => r.categoryCode,
                    },
                    { key: "correct", header: "統一表記", cell: (r) => r.correct.join(" / ") },
                    {
                      key: "wrong",
                      header: "誤表記・正規表現",
                      truncate: "32ch",
                      cell: (r) => (
                        <span className="small">{[...r.incorrect, ...r.patterns].join(" / ")}</span>
                      ),
                    },
                    {
                      key: "years",
                      header: "年度",
                      cell: (r) => (r.years.length ? `MF${r.years.join(",")}` : "全年度"),
                    },
                    {
                      key: "state",
                      header: "取り込み",
                      sort: (a, b) =>
                        Number(existingIds.has(a.ruleId)) - Number(existingIds.has(b.ruleId)),
                      cell: (r) =>
                        !editable(r.categoryCode) ? (
                          <M3eChip className="chip--error">権限なし</M3eChip>
                        ) : existingIds.has(r.ruleId) ? (
                          <M3eChip>{overwrite ? "上書き" : "既存のため除外"}</M3eChip>
                        ) : (
                          <M3eChip className="chip--success">追加</M3eChip>
                        ),
                    },
                  ]}
                />
              </M3eExpansionPanel>
            </M3eAccordion>
            <Checkbox
              checked={overwrite}
              onChange={setOverwrite}
              label="同じ ID のルールがあれば上書きする（版が上がり、履歴に残ります）"
            />
          </>
        ) : null}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={close}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={!preview || preview.rules.length - blocked.length === 0 || run.pending}
          onClick={() => void run.run()}
        >
          取り込む
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
