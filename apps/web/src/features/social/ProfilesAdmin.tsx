import { api } from "@mf100/convex/api";
import {
  SOCIAL_PROFILE_MAX,
  socialPlatformLabels,
  socialPlatforms,
  type SocialPlatform,
} from "@mf100/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";
import { describeError } from "@/lib/errors";
import { Checkbox, Field, TextArea, TextInput } from "@/ui/Field";
import { M3eDialog } from "@/ui/LazyDialog";
import { M3eButton } from "@m3e/react/button";
import { M3eIcon } from "@m3e/react/icon";
import { M3eActionList, M3eListAction } from "@m3e/react/list";
import { M3eLinearProgressIndicator } from "@m3e/react/progress-indicator";
import { toast } from "@/lib/toast";
import { ChoiceGroup } from "@/ui/ChoiceGroup";

type Profile = FunctionReturnType<typeof api.social.list>[number];

/** 画像を中央で正方形に切り抜き、160px の JPEG にする（プレビュー用のアイコン。原寸は保存しない） */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  canvas
    .getContext("2d")!
    .drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 160, 160);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * 管理 › SNS アカウント（本体の設定）。投稿のプレビューに出すアカウントの見た目を登録し、制作物ごとに割り当てる（制作物の「情報」）。
 * M3E のリストで並べ、行を押すとダイアログで直す（M3 に表は無い。§49）。アイコンは画像を選ぶと 160px に縮めて保存する。
 */
export function ProfilesAdmin() {
  const list = useQuery(api.social.list, {});
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  return (
    <section className="stack">
      <p className="muted small">
        投稿のプレビューに出すアカウントの見た目です（実際の SNS
        には接続しません）。制作物ごとに、その制作物の「情報」で使うアカウントを選びます。
        {SOCIAL_PROFILE_MAX} 件まで。
      </p>
      <div className="row">
        <M3eButton
          variant="filled"
          disabled={(list?.length ?? 0) >= SOCIAL_PROFILE_MAX}
          onClick={() => setEditing("new")}
        >
          <M3eIcon slot="icon" name="add" />
          アカウントを追加
        </M3eButton>
      </div>
      {list === undefined ? (
        <M3eLinearProgressIndicator mode="indeterminate" aria-label="SNS アカウントを読み込み中" />
      ) : list.length === 0 ? (
        <div className="empty">まだありません</div>
      ) : (
        <M3eActionList className="list" aria-label="SNS アカウント">
          {list.map((p) => (
            <M3eListAction key={p.id} className="list__item" onClick={() => setEditing(p)}>
              {p.avatar ? (
                <img slot="leading" src={p.avatar} alt="" className="profile-avatar" />
              ) : (
                <M3eIcon slot="leading" name="account_circle" />
              )}
              <span className="list__headline">
                {p.displayName}
                {p.verified ? (
                  <M3eIcon
                    name="verified"
                    className="ml list__lock"
                    role="img"
                    aria-label="認証バッジ"
                    title="認証バッジ"
                  />
                ) : null}
              </span>
              <span slot="supporting-text">
                {[
                  `@${p.username}`,
                  socialPlatformLabels[p.platform],
                  p.stats?.followers !== undefined
                    ? `フォロワー ${p.stats.followers.toLocaleString("ja-JP")}`
                    : null,
                  p.bio || null,
                ]
                  .filter(Boolean)
                  .join("・")}
              </span>
            </M3eListAction>
          ))}
        </M3eActionList>
      )}
      {editing ? (
        <ProfileDialog
          key={editing === "new" ? "new" : editing.id}
          profile={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

/** アカウントの追加・編集（M3 Dialogs: 操作は保存とキャンセルの 2 つ。削除は本文の下） */
function ProfileDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const save = useMutation(api.social.save);
  const remove = useMutation(api.social.remove);
  const fileRef = useRef<HTMLInputElement>(null);
  const [platform, setPlatform] = useState<SocialPlatform>(profile?.platform ?? "instagram");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [followers, setFollowers] = useState(
    profile?.stats?.followers !== undefined ? profile.stats.followers.toLocaleString("ja-JP") : "",
  );
  const [verified, setVerified] = useState(profile?.verified ?? false);
  const [avatar, setAvatar] = useState(profile?.avatar ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const followersOk = followers.trim() === "" || /^\d[\d,，]*$/.test(followers.trim());
  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const n = followers.trim() === "" ? undefined : Number(followers.replace(/[,，]/g, ""));
      const { followers: _f, ...rest } = profile?.stats ?? {};
      const stats = n === undefined ? rest : { ...rest, followers: n };
      await save({
        ...(profile ? { id: profile.id } : {}),
        platform,
        displayName: displayName.trim(),
        username: username.trim(),
        verified,
        ...(avatar ? { avatar } : {}),
        ...(bio.trim() ? { bio: bio.trim() } : {}),
        ...(Object.keys(stats).length ? { stats } : {}),
      });
      toast(profile ? "アカウントを保存しました" : "アカウントを追加しました");
      onClose();
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <M3eDialog open onClosed={onClose} closeLabel="閉じる" className="dialog--narrow">
      <span slot="header">{profile ? `@${profile.username}` : "SNS アカウントを追加"}</span>
      <div className="dialog-body stack">
        {profile ? (
          <p className="small muted">{socialPlatformLabels[profile.platform]}</p>
        ) : (
          <ChoiceGroup
            label="サービス"
            value={platform}
            onChange={setPlatform}
            choices={socialPlatforms.map((p) => ({ value: p, label: socialPlatformLabels[p] }))}
          />
        )}
        <div className="row profile-dialog__avatar">
          {avatar ? (
            <img src={avatar} alt="アイコン" className="profile-avatar profile-avatar--large" />
          ) : (
            <M3eIcon name="account_circle" className="profile-avatar--empty" />
          )}
          <M3eButton variant="tonal" onClick={() => fileRef.current?.click()}>
            <M3eIcon slot="icon" name="add_a_photo" />
            アイコンの画像を選ぶ
          </M3eButton>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                setAvatar(await toAvatarDataUrl(f));
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), { kind: "error" });
              }
            }}
          />
        </div>
        <Field label="表示名" required>
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="ユーザー名（@ なし）" required {...(error ? { error } : {})}>
          <TextInput
            className="mono"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <Field label="自己紹介">
          <TextArea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label="フォロワー数" {...(followersOk ? {} : { error: "0 以上の整数" })}>
          <TextInput
            inputMode="numeric"
            value={followers}
            onChange={(e) => setFollowers(e.target.value)}
          />
        </Field>
        <Checkbox checked={verified} onChange={setVerified} label="認証バッジを付ける" />
        {profile ? (
          <div className="row">
            <M3eButton
              variant="text"
              onClick={async () => {
                try {
                  await remove({ id: profile.id });
                  toast("アカウントを削除しました");
                  onClose();
                } catch (e) {
                  toast(describeError(e).message, { kind: "error" });
                }
              }}
            >
              <M3eIcon slot="icon" name="delete" />
              このアカウントを削除
            </M3eButton>
          </div>
        ) : null}
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={pending || !displayName.trim() || !username.trim() || !followersOk}
          onClick={() => void submit()}
        >
          {profile ? "保存" : "追加"}
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
