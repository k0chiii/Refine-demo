import { api } from "@mf100/convex/api";
import { MEMBER_GROUP_MEMBER_MAX, MEMBER_GROUP_NAME_MAX, type MemberGroup } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { useWindowClass } from "@/lib/useMedia";
import { Loading } from "@/ui/Loading";
import { ActionSheet, type ActionSheetItem } from "@/ui/ActionSheet";
import { Field, TextInput } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { UserPicker } from "@/ui/UserPicker";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eList, M3eListItem } from "@m3e/react/list";
import { M3eMenu, M3eMenuItem, M3eMenuTrigger } from "@m3e/react/menu";

/**
 * 管理 › グループ（利用者指示 2026-10-21）。人の集まりに名前を付け、校正者の割り当てと「@グループ名」のメンションで
 * まとめて選べるようにする。局・担当とは別で、制作物を見られるかには関わらない。
 * 各行の ⋮ から 編集・上へ・下へ・削除（compact はボトムシート。担当の管理と同じ）。
 */
export function GroupsAdmin() {
  const groups = useQuery(api.groups.list, {});
  const save = useMutation(api.groups.save);
  const remove = useMutation(api.groups.remove);
  const compact = useWindowClass() === "compact";
  const [edit, setEdit] = useState<{ group: MemberGroup | null } | null>(null);
  const [form, setForm] = useState({ name: "", memberIds: [] as string[] });
  const [removing, setRemoving] = useState<MemberGroup | null>(null);
  const [sheetFor, setSheetFor] = useState<MemberGroup | null>(null);
  const list = groups ?? [];

  const openEdit = (group: MemberGroup | null) => {
    setForm({ name: group?.name ?? "", memberIds: [...(group?.memberIds ?? [])] });
    setEdit({ group });
  };
  const doSave = useAction(async () => {
    if (!edit) return;
    const name = form.name.trim();
    if (edit.group)
      await save({ id: edit.group.id, name, memberIds: form.memberIds, order: edit.group.order });
    else await save({ name, memberIds: form.memberIds });
    setEdit(null);
  });
  const doRemove = useAction(async () => {
    if (!removing) return;
    await remove({ id: removing.id });
    toast(`「${removing.name}」を削除しました`);
    setRemoving(null);
  });
  // 並べ替え: 隣と順番を入れ替える
  const move = useAction(async (g: MemberGroup, dir: -1 | 1) => {
    const i = list.findIndex((x) => x.id === g.id);
    const other = list[i + dir];
    if (!other) return;
    await save({ id: g.id, name: g.name, memberIds: g.memberIds, order: other.order });
    await save({ id: other.id, name: other.name, memberIds: other.memberIds, order: g.order });
  });

  const actions = (g: MemberGroup): ActionSheetItem[] => {
    const i = list.findIndex((x) => x.id === g.id);
    return [
      { icon: "edit", label: "編集", onSelect: () => openEdit(g) },
      {
        icon: "arrow_upward",
        label: "上へ",
        disabled: i <= 0,
        onSelect: () => void move.run(g, -1),
      },
      {
        icon: "arrow_downward",
        label: "下へ",
        disabled: i === list.length - 1,
        onSelect: () => void move.run(g, 1),
      },
      { icon: "delete", label: "削除", onSelect: () => setRemoving(g) },
    ];
  };
  const more = (g: MemberGroup) => {
    const menuId = `group-menu-${g.id}`;
    return (
      <span slot="trailing" className="teams-admin__more">
        <M3eIconButton
          aria-label={`「${g.name}」の操作`}
          {...(compact ? { onClick: () => setSheetFor(g) } : {})}
        >
          <M3eIcon name="more_vert" />
          {compact ? null : <M3eMenuTrigger htmlFor={menuId} />}
        </M3eIconButton>
        {compact ? null : (
          <M3eMenu id={menuId} positionX="before">
            {actions(g).map((a, k) => (
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

  return (
    <section className="stack teams-admin">
      <div className="row admin-works__actions">
        <M3eButton variant="filled" onClick={() => openEdit(null)}>
          <M3eIcon slot="icon" name="group_add" />
          グループを作る
        </M3eButton>
      </div>
      <p className="muted small">
        校正者の割り当てでグループを選ぶと、所属する人をまとめて加えます。コメントで「@グループ名」と書くと、所属する人のうち制作物を見られる人に知らせます。
      </p>
      {groups === undefined ? (
        <Loading label="グループを読み込んでいます" />
      ) : list.length === 0 ? (
        <div className="empty">まだグループがありません。「グループを作る」から作れます</div>
      ) : (
        <M3eList className="list" aria-label="グループ">
          {list.map((g) => (
            <M3eListItem key={g.id} className="list__item">
              <M3eIcon slot="leading" name="groups" />
              <span className="list__headline">{g.name}</span>
              <span slot="supporting-text">所属 {g.memberIds.length} 人</span>
              {more(g)}
            </M3eListItem>
          ))}
        </M3eList>
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
        <span slot="header">{edit?.group ? "グループを編集" : "グループを作る"}</span>
        <div className="dialog-body">
          <Field
            label="グループの名前"
            hint="メンションでは「@名前」と書きます（「@」は使えません）"
            required
          >
            <TextInput
              required
              autoFocus
              maxLength={MEMBER_GROUP_NAME_MAX}
              placeholder="こうせいはん"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && form.name.trim()) void doSave.run();
              }}
            />
          </Field>
          <UserPicker
            label="所属する人"
            hint={`${MEMBER_GROUP_MEMBER_MAX} 人まで`}
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
            グループを削除します。割り当て済みの校正者と、これまでのメンションの通知はそのまま残ります。
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
    </section>
  );
}
