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
import { DataTable, EditableSwitch, EditableText } from "@/ui/DataTable";
import { Field, TextInput } from "@/ui/Field";
import {
  M3eButton,
  M3eButtonSegment,
  M3eDialog,
  M3eIcon,
  M3eIconButton,
  M3eSegmentedButton,
  M3eSnackbar,
} from "@/ui/m3e";

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
 * 表のセルでその場で直せる。アイコンは画像を選ぶと 160px に縮めて保存する。
 */
export function ProfilesAdmin() {
  const list = useQuery(api.social.list, {});
  const save = useMutation(api.social.save);
  const remove = useMutation(api.social.remove);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarFor, setAvatarFor] = useState<Profile | null>(null);

  const put = async (p: Profile, patch: Partial<Profile>) => {
    const next = { ...p, ...patch };
    try {
      await save({
        id: next.id,
        platform: next.platform,
        displayName: next.displayName,
        username: next.username,
        verified: next.verified,
        ...(next.avatar ? { avatar: next.avatar } : {}),
        ...(next.bio ? { bio: next.bio } : {}),
        ...(next.stats ? { stats: next.stats } : {}),
      });
    } catch (e) {
      throw new Error(describeError(e).message);
    }
  };
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/[,，]/g, "")));
  const numOk = (v: string) =>
    v.trim() === "" || /^\d[\d,，]*$/.test(v.trim()) ? null : "0 以上の整数";

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
          onClick={() => setAdding(true)}
        >
          <M3eIcon slot="icon" name="add" />
          アカウントを追加
        </M3eButton>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !avatarFor) return;
          try {
            await put(avatarFor, { avatar: await toAvatarDataUrl(f) });
          } catch (err) {
            M3eSnackbar.open(err instanceof Error ? err.message : String(err), { duration: 5000 });
          }
        }}
      />
      <DataTable
        label="SNS アカウント"
        rows={list ?? []}
        rowKey={(p) => p.id}
        empty={list === undefined ? "読み込み中…" : "まだありません"}
        columns={[
          {
            key: "avatar",
            header: <span className="sr-only">アイコン</span>,
            width: "72px",
            cell: (p) => (
              <M3eIconButton
                aria-label={`@${p.username} のアイコンを変える`}
                className="profile-avatar-btn"
                onClick={() => {
                  setAvatarFor(p);
                  fileRef.current?.click();
                }}
              >
                {p.avatar ? (
                  <img src={p.avatar} alt="" className="profile-avatar" />
                ) : (
                  <M3eIcon name="add_a_photo" />
                )}
              </M3eIconButton>
            ),
          },
          {
            key: "platform",
            header: "サービス",
            width: "112px",
            sort: (a, b) => a.platform.localeCompare(b.platform),
            cell: (p) => socialPlatformLabels[p.platform],
          },
          {
            key: "name",
            header: "表示名",
            rowHeader: true,
            width: "200px",
            cell: (p) => (
              <EditableText
                label={`@${p.username} の表示名`}
                value={p.displayName}
                onSave={(v) => put(p, { displayName: v })}
              />
            ),
          },
          {
            key: "username",
            header: "ユーザー名",
            width: "200px",
            cell: (p) => (
              <EditableText
                label={`@${p.username} のユーザー名`}
                value={p.username}
                mono
                onSave={(v) => put(p, { username: v })}
              />
            ),
          },
          {
            key: "bio",
            header: "自己紹介",
            cell: (p) => (
              <EditableText
                label={`@${p.username} の自己紹介`}
                value={p.bio ?? ""}
                placeholder="なし"
                onSave={(v) => put(p, { bio: v })}
              />
            ),
          },
          {
            key: "followers",
            header: "フォロワー",
            numeric: true,
            width: "120px",
            cell: (p) => (
              <EditableText
                label={`@${p.username} のフォロワー数`}
                value={p.stats?.followers?.toLocaleString("ja-JP") ?? ""}
                placeholder="—"
                validate={numOk}
                onSave={(v) => {
                  const n = num(v);
                  const { followers: _f, ...rest } = p.stats ?? {};
                  return put(p, { stats: n === undefined ? rest : { ...rest, followers: n } });
                }}
              />
            ),
          },
          {
            key: "verified",
            header: "認証バッジ",
            width: "112px",
            cell: (p) => (
              <EditableSwitch
                label={`@${p.username} に認証バッジを付ける`}
                checked={p.verified}
                onSave={(on) => put(p, { verified: on })}
              />
            ),
          },
          {
            key: "delete",
            header: <span className="sr-only">削除</span>,
            width: "56px",
            cell: (p) => (
              <M3eIconButton
                aria-label={`@${p.username} を削除`}
                onClick={async () => {
                  try {
                    await remove({ id: p.id });
                  } catch (e) {
                    M3eSnackbar.open(describeError(e).message, { duration: 5000 });
                  }
                }}
              >
                <M3eIcon name="delete" />
              </M3eIconButton>
            ),
          },
        ]}
      />
      <AddProfileDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={async (platform, displayName, username) => {
          await save({ platform, displayName, username, verified: false });
        }}
      />
    </section>
  );
}

function AddProfileDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (platform: SocialPlatform, displayName: string, username: string) => Promise<void>;
}) {
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <M3eDialog open={open} onClosed={onClose} closeLabel="閉じる">
      <span slot="header">SNS アカウントを追加</span>
      <div className="dialog-body stack">
        <M3eSegmentedButton aria-label="サービス">
          {socialPlatforms.map((p) => (
            <M3eButtonSegment key={p} checked={platform === p} onClick={() => setPlatform(p)}>
              {socialPlatformLabels[p]}
            </M3eButtonSegment>
          ))}
        </M3eSegmentedButton>
        <Field label="表示名" required>
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="ユーザー名（@ なし）" required {...(error ? { error } : {})}>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
      </div>
      <div slot="actions" className="row">
        <M3eButton variant="text" onClick={onClose}>
          取消
        </M3eButton>
        <M3eButton
          variant="filled"
          disabled={pending || !displayName.trim() || !username.trim()}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              await onAdd(platform, displayName, username);
              setDisplayName("");
              setUsername("");
              onClose();
            } catch (e) {
              setError(describeError(e).message);
            } finally {
              setPending(false);
            }
          }}
        >
          追加
        </M3eButton>
      </div>
    </M3eDialog>
  );
}
