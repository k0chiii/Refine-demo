import { api } from "@mf100/convex/api";
import {
  previewCsvImport,
  previewJsonImport,
  type ImportPreview,
  type RuleDraft,
} from "@mf100/domain";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { useAction } from "@/lib/useAction";
import { Checkbox, Field, TextInput } from "@/ui/Field";
import { M3eButton, M3eDialog, M3eIcon, M3eSnackbar } from "@/ui/m3e";

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
      M3eSnackbar.open("5MB までのファイルを選んでください", { duration: 5000 });
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
    M3eSnackbar.open(
      `追加 ${created}・更新 ${updated}・既存のため除外 ${skipped}${errors.length ? `・失敗 ${errors.length}` : ""}`,
      { duration: 8000 },
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
          <label className="file-button">
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <M3eIcon name="upload_file" />
            ファイルを選ぶ
          </label>
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
            <div className="import-summary">
              <span>ルール {preview.rules.length}</span>
              <span>
                うち既存の ID {preview.rules.filter((r) => existingIds.has(r.ruleId)).length}
              </span>
              <span>説明行 {preview.notes.length}</span>
              <span className={preview.warnings.length ? "warn-text" : ""}>
                警告 {preview.warnings.length}
              </span>
              <span>重複 {preview.duplicates.length}</span>
              <span className={preview.conflicts.length ? "error-text" : ""}>
                矛盾 {preview.conflicts.length}
              </span>
            </div>
            {blocked.length ? (
              <div className="alert">
                権限の無いカテゴリのルール {blocked.length} 件は取り込みません（
                {Array.from(new Set(blocked.map((r) => r.categoryCode))).join("・")}）。
              </div>
            ) : null}
            {preview.conflicts.length ? (
              <details className="details" open>
                <summary>矛盾（同じ誤表記に別の統一表記）</summary>
                <ul className="small">
                  {preview.conflicts.map((c) => (
                    <li key={c.key}>
                      {c.key.replace(/^\w+:/, "")} → {c.corrects.join(" / ")}（
                      {c.ruleIds.join(", ")}）
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {preview.warnings.length ? (
              <details className="details">
                <summary>警告</summary>
                <ul className="small">
                  {preview.warnings.slice(0, 200).map((w, i) => (
                    <li key={i}>
                      {w.line ? `${w.line} 行目: ` : ""}
                      {w.message}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {preview.notes.length ? (
              <details className="details">
                <summary>説明行（カテゴリの運用メモに入れます）</summary>
                <ul className="small">
                  {preview.notes.slice(0, 200).map((n, i) => (
                    <li key={i}>
                      [{n.categoryCode}] {n.text}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="table-wrap" tabIndex={0}>
              <table className="table table--dense">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>カテゴリ</th>
                    <th>統一表記</th>
                    <th>誤表記・正規表現</th>
                    <th>年度</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rules.slice(0, 300).map((r) => (
                    <tr key={r.ruleId} className={existingIds.has(r.ruleId) ? "row--done" : ""}>
                      <td className="small">{r.ruleId}</td>
                      <td>{r.categoryCode}</td>
                      <td>{r.correct.join(" / ")}</td>
                      <td className="small">{[...r.incorrect, ...r.patterns].join(" / ")}</td>
                      <td className="small">{r.years.join(", ") || "全"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rules.length > 300 ? (
                <p className="small muted">ほか {preview.rules.length - 300} 件</p>
              ) : null}
            </div>
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
