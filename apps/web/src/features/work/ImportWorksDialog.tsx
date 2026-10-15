import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  parseWorkCsv,
  resolveWorkImport,
  workCsvColumns,
  workCsvTemplate,
  type PersonMatch,
  type WorkCsvParseResult,
  type WorkImportRow,
} from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { describeError } from "@/lib/errors";
import { formatDeadline } from "@/lib/format";
import { mediaLabel } from "@/lib/labels";
import { toast } from "@/lib/toast";
import { DataTable } from "@/ui/DataTable";
import {
  M3eButton,
  M3eChip,
  M3eChipSet,
  M3eDialog,
  M3eIcon,
  M3eLinearProgressIndicator,
  M3eList,
  M3eListItem,
} from "@/ui/m3e";

/** 雛形の CSV を書き出す（Excel で文字化けしないよう BOM 付きの UTF-8） */
export function downloadWorkCsvTemplate() {
  const blob = new Blob([`﻿${workCsvTemplate()}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "制作物の一括登録.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const person = (m: PersonMatch) =>
  m.user ? (
    <span title={m.user.email ?? undefined}>{m.user.name}</span>
  ) : (
    <span className="import-miss">
      <M3eIcon name="error" className="import-miss__icon" aria-hidden="true" />
      {m.key}
      <span className="sr-only">
        （{m.reason === "ambiguous" ? "同名が複数" : "見つからない"}）
      </span>
    </span>
  );
const people = (list: PersonMatch[]) =>
  list.length ? (
    <>
      {list.map((m, i) => (
        <span key={i}>
          {i > 0 ? "、" : ""}
          {person(m)}
        </span>
      ))}
    </>
  ) : (
    <span className="muted">—</span>
  );

/**
 * 制作物の一括登録（CSV。§36。利用者決定 2026-10-15「制作物の登録は管理者が一括で行う」）。
 * 表記ルールの取り込み（features/notation/ImportDialog）と同じく、読み込んだらまず確認の表を出し、確かめてから登録する。
 * - 解析・検証・担当者の照合は domain（parseWorkCsv / resolveWorkImport）。担当者はメールアドレスかユーザー名で書く
 * - 見つからない担当者・読めない値のある行は、表の「確認」に理由を出し、登録しない
 * - 登録は application の importWorks（権限 works:create・監査）。登録できる行をまとめて 1 回で登録する
 */
export function ImportWorksDialog({
  open,
  onClose,
  existingLegacyIds,
}: {
  open: boolean;
  onClose: () => void;
  existingLegacyIds: readonly string[];
}) {
  const importBatch = useMutation(api.works.importBatch);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<WorkCsvParseResult | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const keys = useMemo(
    () =>
      parsed
        ? Array.from(
            new Set(
              parsed.rows
                .flatMap((r) => [...r.creators, ...r.managers, r.approver])
                .filter(Boolean),
            ),
          )
        : [],
    [parsed],
  );
  const directory = useQuery(api.works.importDirectory, keys.length ? { keys } : "skip");
  const preview = useMemo(
    () =>
      parsed && (keys.length === 0 || directory !== undefined)
        ? resolveWorkImport(parsed, directory ?? [], { existingLegacyIds })
        : null,
    [parsed, directory, keys.length, existingLegacyIds],
  );

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) {
      toast("2MB までの CSV を選んでください", { kind: "warning" });
      return;
    }
    setFileName(f.name);
    setParsed(parseWorkCsv(await f.text(), { defaultYear: 100, now: Date.now() }));
  };
  const close = () => {
    setParsed(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  };
  const ready = preview?.rows.filter((r) => r.input) ?? [];
  const blocked = (preview?.rows.length ?? 0) - ready.length;
  const run = async () => {
    if (!ready.length || pending) return;
    setPending(true);
    try {
      const ids = await importBatch({
        rows: ready.map((r) => {
          const i = r.input!;
          return {
            ...i,
            creatorIds: i.creatorIds as Id<"users">[],
            managerIds: i.managerIds as Id<"users">[],
            approverId: i.approverId as Id<"users">,
          };
        }),
        source: fileName,
      });
      toast(
        `${ids.length} 件の制作物を登録しました${blocked ? `（確認が必要な ${blocked} 行は登録していません）` : ""}`,
      );
      close();
    } catch (e) {
      const d = describeError(e);
      toast(
        d.code === "work_import_invalid"
          ? "登録できない行があったため、1 件も登録していません。CSV を直して読み込み直してください"
          : d.message,
        { kind: "error" },
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <M3eDialog open={open} onClosed={close} closeLabel="閉じる" className="dialog--full">
      <span slot="header">CSV で制作物を一括登録</span>
      <div className="dialog-body stack">
        <p className="small muted">
          1 行に 1 つの制作物を書いた CSV を選びます。列は{" "}
          {workCsvColumns.map((c) => `${c.header}${c.required ? "（必須）" : ""}`).join("・")}。
          担当者はメールアドレスかユーザー名（一度サインインした人）で書き、複数なら「;」で区切ります。登録する前に、内容と担当者の対応をこの表で確かめられます。
        </p>
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <M3eButton variant="outlined" onClick={() => fileRef.current?.click()}>
            <M3eIcon slot="icon" name="upload_file" />
            CSV を選ぶ
          </M3eButton>
          <M3eButton variant="text" onClick={downloadWorkCsvTemplate}>
            <M3eIcon slot="icon" name="download" />
            雛形を書き出す
          </M3eButton>
          <span className="small">{fileName}</span>
        </div>
        {parsed && !preview ? (
          <M3eLinearProgressIndicator mode="indeterminate" aria-label="担当者を照合しています" />
        ) : null}
        {preview ? (
          <>
            <M3eChipSet aria-label="読み込んだ内容" className="import-summary">
              <M3eChip>行 {preview.rows.length}</M3eChip>
              <M3eChip className="chip--success">登録できる {ready.length}</M3eChip>
              <M3eChip className={blocked ? "chip--error" : ""}>確認が必要 {blocked}</M3eChip>
            </M3eChipSet>
            {preview.errors.length ? (
              <M3eList aria-label="ファイルの問題">
                {preview.errors.map((e) => (
                  <M3eListItem key={e}>
                    <M3eIcon slot="leading" name="error" />
                    {e}
                  </M3eListItem>
                ))}
              </M3eList>
            ) : null}
            <DataTable<WorkImportRow>
              label="登録する制作物"
              rows={preview.rows}
              rowKey={(r) => String(r.row.line)}
              defaultSort={{ key: "line", dir: 1 }}
              columns={[
                {
                  key: "line",
                  header: "行",
                  numeric: true,
                  width: "64px",
                  sort: (a, b) => a.row.line - b.row.line,
                  cell: (r) => r.row.line,
                },
                {
                  key: "title",
                  header: "題名",
                  rowHeader: true,
                  truncate: "24ch",
                  cell: (r) => r.row.title || <span className="muted">（なし）</span>,
                },
                {
                  key: "media",
                  header: "媒体",
                  cell: (r) => (r.row.mediaType ? mediaLabel[r.row.mediaType] : "—"),
                },
                { key: "creators", header: "制作者", cell: (r) => people(r.creators) },
                { key: "managers", header: "主管", cell: (r) => people(r.managers) },
                {
                  key: "approver",
                  header: "校了権限者",
                  cell: (r) => (r.approver ? person(r.approver) : <span className="muted">—</span>),
                },
                {
                  key: "deadline",
                  header: "納期",
                  cell: (r) => (r.row.deadlineAt ? formatDeadline(r.row.deadlineAt) : "—"),
                },
                {
                  key: "state",
                  header: "確認",
                  sort: (a, b) => Number(a.input !== null) - Number(b.input !== null),
                  cell: (r) =>
                    r.input ? (
                      <M3eChip className="chip--success">登録する</M3eChip>
                    ) : (
                      <span className="small import-problems">
                        {r.problems.join("。") || "ファイルの問題（表の上）を直してください"}
                      </span>
                    ),
                },
              ]}
            />
          </>
        ) : null}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={close}>
          キャンセル
        </M3eButton>
        <M3eButton variant="filled" disabled={!ready.length || pending} onClick={() => void run()}>
          {ready.length ? `${ready.length} 件を登録する` : "登録する"}
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
