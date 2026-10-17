import { api } from "@mf100/convex/api";
import {
  bureauCodes,
  matchPerson,
  parseTeamCsv,
  planTeamImport,
  sortTeams,
  teamCsvTemplate,
  type PersonMatch,
  type Team,
  type TeamCsvParseResult,
} from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { Fragment, useMemo, useRef, useState } from "react";
import { describeError } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { useWindowClass } from "@/lib/useMedia";
import { Loading } from "@/ui/Loading";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { Field, Select, TextInput } from "@/ui/Field";
import {
  M3eButton,
  M3eDialog,
  M3eDivider,
  M3eIcon,
  M3eIconButton,
  M3eLinearProgressIndicator,
  M3eList,
  M3eListItem,
  M3eMenu,
  M3eMenuItem,
  M3eMenuTrigger,
} from "@/ui/m3e";
import { UserPicker } from "@/ui/UserPicker";

/**
 * 管理 › 担当（利用者決定 2026-10-15: 「局 › 担当」の 2 段は管理画面で持つ。Nogiku の組織情報との同期は後続）。
 * 局ごとに担当を並べ、各行の ⋮ から 編集（名前・絵文字・Drive・所属。局はコードも）・上へ・下へ・削除（compact はボトムシート。M3 Breakpoints）。
 * 項目は Notion の担当 DB に揃える（利用者決定 2026-10-17。docs/NOTION_ALIGNMENT.md）: 局（コード JIM・ZAI・SSK・EVE・PR・SYS・WG・CAP）・
 * 付番（並び順）・絵文字・Google Drive フォルダ・ユーザ（所属する人）。
 * まとめて作るときは CSV（Notion の担当 DB の列名）。取り込みは何度やっても同じ（既にある局・担当は作らない）。
 * 制作物が使っている担当と、担当のある局は消せない（domain の team_in_use）。
 */
export function TeamsAdmin() {
  const teams = useQuery(api.teams.list, {});
  const save = useMutation(api.teams.save);
  const remove = useMutation(api.teams.remove);
  const compact = useWindowClass() === "compact";
  const [edit, setEdit] = useState<
    | { mode: "add-bureau" }
    | { mode: "add-team"; bureau: Team }
    | { mode: "edit"; team: Team }
    | null
  >(null);
  const [form, setForm] = useState({
    name: "",
    code: "",
    emoji: "",
    driveFolderUrl: "",
    memberIds: [] as string[],
  });
  const [removing, setRemoving] = useState<Team | null>(null);
  const [sheetFor, setSheetFor] = useState<Team | null>(null);
  const [importing, setImporting] = useState(false);

  const sorted = sortTeams(teams ?? []);
  const bureaus = sorted.filter((t) => t.kind === "bureau");
  const childrenOf = (b: Team) => sorted.filter((t) => t.parentId === b.id);
  const siblings = (t: Team) =>
    t.kind === "bureau" ? bureaus : sorted.filter((x) => x.parentId === t.parentId);
  const isBureau =
    edit?.mode === "add-bureau" || (edit?.mode === "edit" && edit.team.kind === "bureau");

  const doSave = useAction(async () => {
    if (!edit) return;
    const meta = {
      emoji: form.emoji.trim() || null,
      driveFolderUrl: form.driveFolderUrl.trim() || null,
      memberIds: form.memberIds,
      ...(isBureau ? { code: form.code || null } : {}),
    };
    const name = form.name.trim();
    if (edit.mode === "add-bureau") await save({ name, kind: "bureau", ...meta });
    else if (edit.mode === "add-team")
      await save({ name, kind: "team", parentId: edit.bureau.id, ...meta });
    else
      await save({
        id: edit.team.id,
        name,
        kind: edit.team.kind,
        ...(edit.team.parentId ? { parentId: edit.team.parentId } : {}),
        order: edit.team.order,
        ...meta,
      });
    setEdit(null);
  });
  const doRemove = useAction(async () => {
    if (!removing) return;
    await remove({ id: removing.id });
    toast(`「${removing.name}」を削除しました`);
    setRemoving(null);
  });
  // 並べ替え: 隣と順番を入れ替える（コードなどの項目は省略＝そのまま）
  const move = useAction(async (t: Team, dir: -1 | 1) => {
    const list = siblings(t);
    const i = list.findIndex((x) => x.id === t.id);
    const other = list[i + dir];
    if (!other) return;
    const base = { kind: t.kind, ...(t.parentId ? { parentId: t.parentId } : {}) };
    await save({ id: t.id, name: t.name, ...base, order: other.order });
    await save({ id: other.id, name: other.name, ...base, order: t.order });
  });

  const openEdit = (next: NonNullable<typeof edit>) => {
    const t = next.mode === "edit" ? next.team : null;
    setForm({
      name: t?.name ?? "",
      code: t?.code ?? "",
      emoji: t?.emoji ?? "",
      driveFolderUrl: t?.driveFolderUrl ?? "",
      memberIds: [...(t?.memberIds ?? [])],
    });
    setEdit(next);
  };
  const actions = (t: Team): ActionSheetItem[] => {
    const list = siblings(t);
    const i = list.findIndex((x) => x.id === t.id);
    return [
      ...(t.kind === "bureau"
        ? [
            {
              icon: "group_add",
              label: "担当を追加",
              onSelect: () => openEdit({ mode: "add-team", bureau: t }),
            },
          ]
        : []),
      {
        icon: "edit",
        label: "編集",
        onSelect: () => openEdit({ mode: "edit", team: t }),
      },
      {
        icon: "arrow_upward",
        label: "上へ",
        disabled: i <= 0,
        onSelect: () => void move.run(t, -1),
      },
      {
        icon: "arrow_downward",
        label: "下へ",
        disabled: i === list.length - 1,
        onSelect: () => void move.run(t, 1),
      },
      { icon: "delete", label: "削除", onSelect: () => setRemoving(t) },
    ];
  };
  const more = (t: Team) => {
    const menuId = `team-menu-${t.id}`;
    return (
      <span slot="trailing" className="teams-admin__more">
        <M3eIconButton
          aria-label={`「${t.name}」の操作`}
          {...(compact ? { onClick: () => setSheetFor(t) } : {})}
        >
          <M3eIcon name="more_vert" />
          {compact ? null : <M3eMenuTrigger htmlFor={menuId} />}
        </M3eIconButton>
        {compact ? null : (
          <M3eMenu id={menuId} positionX="before">
            {actions(t).map((a, k) => (
              <M3eMenuItem key={k} disabled={a.disabled === true} onClick={a.onSelect}>
                <M3eIcon slot="icon" name={a.icon} />
                {a.label}
              </M3eMenuItem>
            ))}
          </M3eMenu>
        )}
      </span>
    );
  };
  /** 行の見出し: 絵文字 → 名前（局はコードも） */
  const headline = (t: Team) => (
    <span className="list__headline">
      {t.emoji ? <span className="teams-admin__emoji">{t.emoji}</span> : null}
      {t.name}
      {t.code ? <span className="teams-admin__code">{t.code}</span> : null}
    </span>
  );
  const supporting = (t: Team) =>
    [
      t.kind === "bureau" ? `担当 ${childrenOf(t).length}` : null,
      t.memberIds?.length ? `所属 ${t.memberIds.length} 人` : null,
      t.driveFolderUrl ? "Drive" : null,
    ]
      .filter(Boolean)
      .join("・");

  return (
    <section className="stack teams-admin">
      <div className="row admin-works__actions">
        <M3eButton variant="filled" onClick={() => openEdit({ mode: "add-bureau" })}>
          <M3eIcon slot="icon" name="add" />
          局を追加
        </M3eButton>
        <M3eButton variant="outlined" onClick={() => setImporting(true)}>
          <M3eIcon slot="icon" name="upload_file" />
          CSV で取り込む
        </M3eButton>
        <M3eButton variant="text" onClick={downloadTeamCsvTemplate}>
          <M3eIcon slot="icon" name="download" />
          雛形を書き出す
        </M3eButton>
      </div>
      <p className="muted small">
        制作物には主管担当と制作担当・関係担当を選べます。項目は Notion の「担当」DB
        と同じ（局のコード・絵文字・Google Drive フォルダ・所属する人）
      </p>
      {teams === undefined ? (
        <Loading label="担当を読み込んでいます" />
      ) : bureaus.length === 0 ? (
        <div className="empty">まだ局がありません。「局を追加」か CSV で作れます</div>
      ) : (
        // 局ごとに 1 つのリスト（区切り線はリストの外。list の子に separator は置けない）
        bureaus.map((b, i) => (
          <Fragment key={b.id}>
            {i > 0 ? <M3eDivider /> : null}
            <M3eList className="list" aria-label={b.name}>
              <M3eListItem className="list__item teams-admin__bureau-item">
                <M3eIcon slot="leading" name="corporate_fare" />
                {headline(b)}
                <span slot="supporting-text">{supporting(b)}</span>
                {more(b)}
              </M3eListItem>
              {childrenOf(b).map((t) => (
                <M3eListItem key={t.id} className="list__item teams-admin__team">
                  <M3eIcon slot="leading" name="groups" />
                  {headline(t)}
                  {supporting(t) ? <span slot="supporting-text">{supporting(t)}</span> : null}
                  {more(t)}
                </M3eListItem>
              ))}
            </M3eList>
          </Fragment>
        ))
      )}

      <ActionSheet
        open={sheetFor !== null}
        onClose={() => setSheetFor(null)}
        {...(sheetFor ? { title: sheetFor.name } : {})}
        items={sheetFor ? actions(sheetFor) : []}
      />

      <M3eDialog
        open={edit !== null}
        onClosed={() => setEdit(null)}
        closeLabel="閉じる"
        className={compact ? "dialog--full" : ""}
      >
        <span slot="header">
          {edit?.mode === "add-bureau"
            ? "局を追加"
            : edit?.mode === "add-team"
              ? `担当を追加（${edit.bureau.name}）`
              : edit?.team.kind === "bureau"
                ? "局を編集"
                : "担当を編集"}
        </span>
        <div className="dialog-body">
          <Field label={isBureau ? "局の名前" : "担当の名前"} required>
            <TextInput
              required
              autoFocus
              maxLength={40}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && form.name.trim()) void doSave.run();
              }}
            />
          </Field>
          <div className="form">
            {isBureau ? (
              <Field label="局のコード" hint="Notion の「局」の選択肢">
                <Select
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                >
                  <option value="">なし</option>
                  {bureauCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="絵文字">
              <TextInput
                maxLength={8}
                placeholder="🎨"
                value={form.emoji}
                onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Google Drive フォルダ" hint="https://drive.google.com/… の URL">
            <TextInput
              type="url"
              placeholder="https://drive.google.com/drive/folders/…"
              value={form.driveFolderUrl}
              onChange={(e) => setForm((f) => ({ ...f, driveFolderUrl: e.target.value }))}
            />
          </Field>
          <UserPicker
            label="所属する人（ユーザ）"
            hint="名簿の代わり。これだけでは制作物の閲覧権限は付きません"
            value={form.memberIds}
            onChange={(ids) => setForm((f) => ({ ...f, memberIds: ids }))}
          />
        </div>
        <div slot="actions" className="row">
          <span className="spacer" />
          <M3eButton variant="text" onClick={() => setEdit(null)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doSave.pending || !form.name.trim()}
            onClick={() => void doSave.run()}
          >
            保存
          </M3eButton>
        </div>
      </M3eDialog>

      <M3eDialog open={removing !== null} onClosed={() => setRemoving(null)} closeLabel="閉じる">
        <span slot="header">「{removing?.name}」を削除しますか？</span>
        <div className="dialog-body">
          <p>
            {removing?.kind === "bureau"
              ? "局を削除します。担当が残っている局は削除できません。"
              : "担当を削除します。制作物が使っている担当は削除できません。"}
          </p>
        </div>
        <div slot="actions" className="row">
          <span className="spacer" />
          <M3eButton variant="text" onClick={() => setRemoving(null)}>
            キャンセル
          </M3eButton>
          <M3eButton
            variant="filled"
            disabled={doRemove.pending}
            onClick={() => void doRemove.run()}
          >
            削除
          </M3eButton>
        </div>
      </M3eDialog>

      <ImportTeamsDialog
        open={importing}
        onClose={() => setImporting(false)}
        existing={teams ?? []}
      />
    </section>
  );
}

export function downloadTeamCsvTemplate() {
  const blob = new Blob([`﻿${teamCsvTemplate()}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "局と担当（Notion の列名）.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * CSV（Notion の担当 DB の列名: 局・担当名・付番・絵文字・Google Drive フォルダ・ユーザ）の取り込み。
 * 作る局・担当と、既にあるものの数、所属する人の照合（メールアドレスかユーザー名）を確かめてから取り込む。
 * 見つからない人がいる行も取り込めるが、その人は所属に入れない（行ごとに知らせる）
 */
function ImportTeamsDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing: readonly Team[];
}) {
  const importBatch = useMutation(api.teams.importBatch);
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<TeamCsvParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [pending, setPending] = useState(false);
  const keys = useMemo(
    () => (parsed ? Array.from(new Set(parsed.rows.flatMap((r) => r.members))) : []),
    [parsed],
  );
  const directory = useQuery(api.teams.importDirectory, keys.length ? { keys } : "skip");
  const matches = useMemo(() => {
    if (!parsed) return null;
    const dir = directory ?? [];
    return new Map(
      parsed.rows.map((r) => [r.line, r.members.map((k) => matchPerson(k, dir))] as const),
    );
  }, [parsed, directory]);
  const memberIds = useMemo(() => {
    const out = new Map<number, string[]>();
    for (const [line, list] of matches ?? [])
      out.set(
        line,
        list.flatMap((m) => (m.user ? [m.user.id] : [])),
      );
    return out;
  }, [matches]);
  const resolving = keys.length > 0 && directory === undefined;
  const plan = parsed && !resolving ? planTeamImport(parsed.rows, existing, memberIds) : null;
  const misses = (list: PersonMatch[] | undefined) => (list ?? []).filter((m) => !m.user);
  const close = () => {
    setParsed(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 500_000) {
      toast("500KB までの CSV を選んでください", { kind: "warning" });
      return;
    }
    setFileName(f.name);
    setParsed(parseTeamCsv(await f.text()));
  };
  const run = async () => {
    if (!parsed || !plan || plan.create.length === 0 || pending) return;
    setPending(true);
    try {
      const r = await importBatch({
        rows: parsed.rows.map((row) => ({
          line: row.line,
          bureau: row.bureau,
          team: row.team,
          ...(row.order !== undefined ? { order: row.order } : {}),
          ...(row.emoji ? { emoji: row.emoji } : {}),
          ...(row.driveFolderUrl ? { driveFolderUrl: row.driveFolderUrl } : {}),
          memberIds: memberIds.get(row.line) ?? [],
        })),
      });
      toast(
        `${r.created} 件を追加しました${r.existing ? `（既にある ${r.existing} 件はそのまま）` : ""}`,
      );
      close();
    } catch (e) {
      toast(describeError(e).message, { kind: "error" });
    } finally {
      setPending(false);
    }
  };
  return (
    <M3eDialog open={open} onClosed={close} closeLabel="閉じる" className="dialog--full">
      <span slot="header">CSV で局と担当を取り込む</span>
      <div className="dialog-body stack">
        <p className="small muted">
          列は Notion の「担当」DB の書き出しと同じ（局・担当名・付番・絵文字・Google Drive
          フォルダ・ユーザ）。局は名前かコード（PR・JIM
          など）で書き、担当を空にすると局だけを作ります。Notion
          の「局」に複数あれば先頭の局に入れます。既にある局・担当は作りません。
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
          {fileName ? <span className="small">{fileName}</span> : null}
        </div>
        {resolving ? (
          <M3eLinearProgressIndicator
            mode="indeterminate"
            aria-label="所属する人を照合しています"
          />
        ) : null}
        {parsed && plan ? (
          <>
            {parsed.errors.length ? (
              <div className="alert" role="alert">
                {parsed.errors.map((e) => (
                  <div key={e.line}>
                    {e.line} 行目: {e.message}
                  </div>
                ))}
              </div>
            ) : null}
            <p>
              新しく作る: {plan.create.length} 件・既にある: {plan.existing} 件
            </p>
            {plan.create.length ? (
              <M3eList className="list" aria-label="新しく作る局と担当">
                {plan.create.map((c, i) => (
                  <M3eListItem key={i} className="list__item">
                    <M3eIcon slot="leading" name={c.team ? "groups" : "corporate_fare"} />
                    <span className="list__headline">
                      {c.emoji ? `${c.emoji} ` : ""}
                      {c.team ? `${c.bureau} › ${c.team}` : c.bureau}
                      {c.code ? <span className="teams-admin__code">{c.code}</span> : null}
                    </span>
                    {c.memberIds?.length || c.driveFolderUrl ? (
                      <span slot="supporting-text">
                        {[
                          c.memberIds?.length ? `所属 ${c.memberIds.length} 人` : null,
                          c.driveFolderUrl ? "Drive" : null,
                        ]
                          .filter(Boolean)
                          .join("・")}
                      </span>
                    ) : null}
                  </M3eListItem>
                ))}
              </M3eList>
            ) : null}
            {/* 行ごとの知らせ: 局が複数・見つからない人 */}
            {parsed.rows.some((r) => r.notes.length || misses(matches?.get(r.line)).length) ? (
              <M3eList className="list" aria-label="確認してほしいこと">
                {parsed.rows
                  .filter((r) => r.notes.length || misses(matches?.get(r.line)).length)
                  .map((r) => (
                    <M3eListItem key={r.line} className="list__item">
                      <M3eIcon slot="leading" name="info" />
                      <span slot="overline">{r.line} 行目</span>
                      <span className="list__headline">
                        {r.team ? `${r.bureau} › ${r.team}` : r.bureau}
                      </span>
                      <span slot="supporting-text">
                        {[
                          ...r.notes,
                          ...misses(matches?.get(r.line)).map(
                            (m) =>
                              `「${m.key}」${m.reason === "ambiguous" ? "に当たる人が複数います" : "が見つかりません"}（所属に入れません）`,
                          ),
                        ].join("。")}
                      </span>
                    </M3eListItem>
                  ))}
              </M3eList>
            ) : null}
          </>
        ) : null}
      </div>
      <div slot="actions" className="row">
        <span className="spacer" />
        <M3eButton variant="text" onClick={close}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={pending || !plan || plan.create.length === 0}
          onClick={() => void run()}
        >
          {plan ? `${plan.create.length} 件を取り込む` : "取り込む"}
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
