import { api } from "@mf100/convex/api";
import { SLACK_WORKSPACE_NAME_MAX, type SlackWorkspace } from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import { useState, type KeyboardEvent } from "react";
import { isImeKeyEvent } from "@/lib/ime";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { Field, TextInput } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { Loading } from "@/ui/Loading";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import { M3eList, M3eListItem } from "@m3e/react/list";

/**
 * 管理 › Slack（§105。利用者指示 2026-10-28「ADMINの管理画面でWS名とTEAM_IDの登録画面を作る→みんなは設定画面でWSを選ぶだけにしたい」）。
 * Slack（DM）の通知を送るワークスペースを、名前と team_id で登録・削除する。各自は「通知の設定」の Slack（DM）の行で選ぶ
 */
export function SlackWorkspacesAdmin() {
  const workspaces = useQuery(api.slackWorkspaces.list, {});
  const add = useMutation(api.slackWorkspaces.add);
  const remove = useMutation(api.slackWorkspaces.remove);
  const [form, setForm] = useState({ name: "", teamId: "" });
  const [removing, setRemoving] = useState<SlackWorkspace | null>(null);
  const ready = form.name.trim() !== "" && form.teamId.trim() !== "";
  const doAdd = useAction(async () => {
    const created = await add(form);
    toast(`「${created.name}」を登録しました`);
    setForm({ name: "", teamId: "" });
  });
  const doRemove = useAction(async () => {
    if (!removing) return;
    await remove({ id: removing.id });
    toast(`「${removing.name}」を削除しました`);
    setRemoving(null);
  });
  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isImeKeyEvent(e.nativeEvent) && ready) void doAdd.run();
  };

  return (
    <section className="stack">
      <p className="admin__lead">
        Slack（DM）の通知を送るワークスペースです。各自が「通知の設定」で、この中から選びます。
      </p>
      {workspaces === undefined ? (
        <Loading label="ワークスペースを読み込んでいます" />
      ) : workspaces.length === 0 ? (
        <div className="empty">
          まだ登録がありません。team_id は、ブラウザ版 Slack の URL
          （https://app.slack.com/client/Txxxx/…）の Txxxx です
        </div>
      ) : (
        <M3eList className="list" aria-label="Slack のワークスペース">
          {workspaces.map((w) => (
            <M3eListItem key={w.id} className="list__item admin-slack__row" data-team-id={w.teamId}>
              <M3eIcon slot="leading" name="forum" />
              <span className="list__headline">{w.name}</span>
              <span slot="supporting-text" className="small muted">
                {w.teamId}
              </span>
              <M3eIconButton
                slot="trailing"
                aria-label={`「${w.name}」を削除`}
                title="削除"
                onClick={() => setRemoving(w)}
              >
                <M3eIcon name="delete" />
              </M3eIconButton>
            </M3eListItem>
          ))}
        </M3eList>
      )}
      {/* 登録できたら欄を空に戻すので required は付けない（空に戻した欄が入力の誤りの赤のまま残る） */}
      <div className="admin-slack__form">
        <Field label="ワークスペースの名前">
          <TextInput
            name="name"
            maxLength={SLACK_WORKSPACE_NAME_MAX}
            placeholder="五月祭"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={submitOnEnter}
          />
        </Field>
        <Field label="team_id" hint="T で始まる英数字">
          <TextInput
            name="teamId"
            className="mono"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="T0123ABCD"
            value={form.teamId}
            onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))}
            onKeyDown={submitOnEnter}
          />
        </Field>
        <M3eButton
          variant="filled"
          disabled={!ready || doAdd.pending}
          onClick={() => void doAdd.run()}
        >
          <M3eIcon slot="icon" name="add" />
          登録
        </M3eButton>
      </div>

      <M3eDialog open={removing !== null} onClosed={() => setRemoving(null)} closeLabel="閉じる">
        <span slot="header">「{removing?.name}」を削除しますか？</span>
        <div className="dialog-body">
          <p>このワークスペースを選んでいた人には、Slack の通知を送らなくなります。</p>
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
