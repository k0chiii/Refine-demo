import { api } from "@mf100/convex/api";
import type { Id } from "@mf100/convex/dataModel";
import {
  parseWorkCsv,
  resolveWorkImport,
  teamPath,
  workCsvTemplate,
  workCsvTemplateColumns,
  type PersonMatch,
  type Team,
  type TeamRefMatch,
  type WorkCsvParseResult,
  workSubGenreLabel,
} from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { describeError } from "@/lib/errors";
import { formatDeadline } from "@/lib/format";
import { mediaLabel } from "@/lib/labels";
import { toast } from "@/lib/toast";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eList, M3eListItem } from "@m3e/react/list";
import { M3eLinearProgressIndicator } from "@m3e/react/progress-indicator";

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

const teamRef = (m: TeamRefMatch, teams: readonly Team[]) =>
  m.match.kind === "ok" ? (
    <span>{teamPath(m.match.team.id, teams) ?? m.match.team.name}</span>
  ) : (
    <span className="import-miss">
      <M3eIcon name="error" className="import-miss__icon" aria-hidden="true" />
      {m.key}
      <span className="sr-only">
        （{m.match.kind === "ambiguous" ? "同名の担当が複数" : "見つからない"}）
      </span>
    </span>
  );
const teamRefs = (list: TeamRefMatch[], teams: readonly Team[]) =>
  list.length ? (
    <>
      {list.map((m, i) => (
        <span key={i}>
          {i > 0 ? "、" : ""}
          {teamRef(m, teams)}
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
 * - 主管担当・制作担当（組織）は管理画面の組織（局 › 担当）と照合する（「広報局 › デザイン担当」など）
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
                .flatMap((r) => [...r.creators, ...r.managers, ...r.stakeholders, ...r.approvers])
                .filter(Boolean),
            ),
          )
        : [],
    [parsed],
  );
  const directory = useQuery(api.works.importDirectory, keys.length ? { keys } : "skip");
  const teams = useQuery(api.teams.list, open ? {} : "skip");
  const preview = useMemo(
    () =>
      parsed && (keys.length === 0 || directory !== undefined) && teams !== undefined
        ? resolveWorkImport(parsed, directory ?? [], { existingLegacyIds }, teams)
        : null,
    [parsed, directory, keys.length, existingLegacyIds, teams],
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
            stakeholderIds: i.stakeholderIds ?? [],
            approverIds: i.approverIds as Id<"users">[],
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
          雛形と同じ列の CSV を選んでください（書き方は雛形の見出し行に）
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
          <M3eLinearProgressIndicator
            mode="indeterminate"
            aria-label="担当者と担当を照合しています"
          />
        ) : null}
        {preview ? (
          <>
            <p className="import-summary" aria-label="読み込んだ内容">
              <span>行 {preview.rows.length}</span>
              <span className="import-summary__ok">
                <M3eIcon name="check_circle" />
                登録できる {ready.length}
              </span>
              <span className={blocked ? "import-summary__bad" : ""}>
                {blocked ? <M3eIcon name="error" /> : null}確認が必要 {blocked}
              </span>
            </p>
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
            {/* 1 行ずつ: 先頭のアイコンと末尾の文字で登録できるかを示し、問題はその行の中に全部出す（M3 Dialogs: エラーはその場に） */}
            <M3eList className="list import-list" aria-label="登録する制作物">
              {[...preview.rows]
                .sort((a, b) => a.row.line - b.row.line)
                .map((r) => (
                  <M3eListItem
                    key={r.row.line}
                    className={`list__item ${r.input ? "" : "import-list__item--bad"}`}
                  >
                    <M3eIcon slot="leading" name={r.input ? "check_circle" : "error"} />
                    <span slot="overline">{r.row.line} 行目</span>
                    <span className="list__headline">
                      {r.row.title || <span className="muted">（制作物名なし）</span>}
                    </span>
                    <span slot="supporting-text" className="import-list__detail">
                      {r.row.subGenre
                        ? workSubGenreLabel(r.row.subGenre)
                        : r.row.category || "区分なし"}
                      ・{r.row.mediaType ? mediaLabel[r.row.mediaType] : "媒体なし"}・制作者{" "}
                      {people(r.creators)}・統括 {people(r.managers)}・担当{" "}
                      {r.ownerTeam ? teamRef(r.ownerTeam, teams ?? []) : "—"}・制作担当{" "}
                      {teamRefs(r.productionTeams, teams ?? [])}・校了する人 {people(r.approvers)}
                      {r.row.approvalQuorum !== null && r.approvers.length > 1
                        ? `（${r.row.approvalQuorum} 人で校了）`
                        : ""}
                      {r.stakeholders.length ? <>・関係者 {people(r.stakeholders)}</> : null}・納期{" "}
                      {r.row.deadlineAt ? formatDeadline(r.row.deadlineAt) : "—"}
                      {r.row.tags.length ? `・タグ ${r.row.tags.join("、")}` : ""}
                      {r.input ? null : (
                        <span className="import-list__problems">
                          {r.problems.join("。") || "ファイルの問題（上）を直してください"}
                        </span>
                      )}
                    </span>
                    <span slot="trailing" className="meta">
                      {r.input ? "登録する" : "確認が必要"}
                    </span>
                  </M3eListItem>
                ))}
            </M3eList>
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
