import { useId, useState } from "react";
import { ActionSheet } from "@/ui/ActionSheet";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { M3eDivider } from "@m3e/react/divider";
import { M3eIcon } from "@m3e/react/icon";
import { M3eIconButton } from "@m3e/react/icon-button";
import {
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemCheckbox,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@m3e/react/menu";
import { DEVICES, deviceById, type DeviceKind } from "./devices";
import type { PreviewView } from "./PostPreview";

const GROUPS: readonly [DeviceKind, string][] = [
  ["iphone", "iPhone"],
  ["android", "Android"],
  ["pc", "PC"],
];
const deviceLabel = (d: (typeof DEVICES)[number]) =>
  d.kind === "pc" ? d.label : `${d.label}（${d.w}×${d.h}）`;

/**
 * プレビューの表示設定（機種・本体の色・投稿／プロフィール・安全領域・全画面）。
 * 浮いていた FAB（FAB menu）をやめ、共通アプリバーの末尾の操作（`#appbar-actions`）へ「tune」のアイコンボタンとして置く
 * （利用者指示 2026-10-18「SNS の画面切り替えの設定ボタン、アップバーに統一できないかな」。M3 App bars: 画面の操作はバーの末尾）。
 * プレビューが画面にある間だけ出る（このコンポーネントが描かれている間だけ AppBarSlot が受け皿へ差し込む）。
 *
 * - 押すと、ボタンの下に M3E menu。機種・本体の色・表示（投稿／プロフィール）・安全領域・全画面の項目は従来と同じ
 * - compact: 機種・本体の色は項目からボトムシートを開いて選ぶ（選択肢が多いため。従来どおり）。
 *   それより広い画面はサブメニューのラジオ
 * - 項目が 1 つしかない（機種だけ）ときは menu にせず、機種の選択を直接開く
 * - 全画面のプレビュー（FullscreenPreview）はバーを覆うので、そこでは右上の ✕・Esc・戻る操作で閉じる（従来どおり）
 * - 並びはバーの中でいちばん左（`.appbar-preview-settings` の order。比べる・ピンの位置は動かさない）
 */
export function PreviewSettings({
  device,
  color,
  onDevice,
  view,
  onView,
  safeArea,
  onSafeArea,
  onFullscreen,
  compact,
}: {
  device: string;
  color?: string | undefined;
  onDevice: (next: { device: string; color?: string }) => void;
  /** Instagram の投稿・カルーセルのときだけ（ストーリーズ・X には無い） */
  view?: PreviewView | undefined;
  onView?: ((v: PreviewView) => void) | undefined;
  /** ストーリーズの編集のときだけ */
  safeArea?: boolean | undefined;
  onSafeArea?: ((v: boolean) => void) | undefined;
  /** スマホの幅のときだけ */
  onFullscreen?: (() => void) | undefined;
  compact: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const [sheet, setSheet] = useState<"device" | "color" | null>(null);
  const spec = deviceById(device);
  const colors = spec.bezel?.colors ?? [];
  const curColor = colors.find((c) => c.id === color) ?? colors[0];
  const hasColor = colors.length > 1 && !!curColor;
  const hasView = view !== undefined && !!onView;
  const hasSafe = safeArea !== undefined && !!onSafeArea;
  const single = !hasColor && !hasView && !hasSafe && !onFullscreen;
  const icon = spec.kind === "pc" ? "computer" : "smartphone";
  const label = "プレビューの設定（機種・表示）";

  const sheets = (
    <>
      <ActionSheet
        open={sheet === "device"}
        onClose={() => setSheet(null)}
        title="機種"
        items={DEVICES.map((d) => ({
          icon: d.kind === "pc" ? "computer" : "smartphone",
          label: deviceLabel(d),
          selected: d.id === spec.id,
          onSelect: () => onDevice({ device: d.id }),
        }))}
      />
      {hasColor ? (
        <ActionSheet
          open={sheet === "color"}
          onClose={() => setSheet(null)}
          title="本体の色"
          items={colors.map((c) => ({
            icon: "palette",
            label: c.label,
            selected: c.id === curColor.id,
            onSelect: () => onDevice({ device: spec.id, color: c.id }),
          }))}
        />
      ) : null}
    </>
  );

  const deviceMenu = (
    <M3eMenu id={`${id}-device`} positionY="below" positionX="before">
      {GROUPS.map(([kind, name], gi) => (
        <M3eMenuItemGroup key={kind} aria-label={name}>
          {gi > 0 ? <M3eDivider /> : null}
          {DEVICES.filter((d) => d.kind === kind).map((d) => (
            <M3eMenuItemRadio
              key={d.id}
              checked={d.id === spec.id}
              onClick={() => onDevice({ device: d.id })}
            >
              {deviceLabel(d)}
            </M3eMenuItemRadio>
          ))}
        </M3eMenuItemGroup>
      ))}
    </M3eMenu>
  );
  const button = (menuId: string | null, aria: string, iconName: string, onClick?: () => void) => (
    <M3eIconButton
      aria-label={aria}
      title={aria}
      className="appbar-preview-settings"
      {...(onClick ? { onClick } : {})}
    >
      <M3eIcon name={iconName} />
      {menuId ? <M3eMenuTrigger htmlFor={menuId} /> : null}
    </M3eIconButton>
  );

  // 機種だけ: compact はボトムシート、それより広い画面は機種の menu を直接開く
  if (single)
    return (
      <>
        <AppBarSlot slot="actions">
          {compact ? (
            button(null, "機種を選ぶ", icon, () => setSheet("device"))
          ) : (
            <>
              {button(`${id}-device`, "機種を選ぶ", icon)}
              {deviceMenu}
            </>
          )}
        </AppBarSlot>
        {compact ? sheets : null}
      </>
    );
  return (
    <>
      <AppBarSlot slot="actions">
        {button(`${id}-menu`, label, "tune")}
        <M3eMenu id={`${id}-menu`} positionY="below" positionX="before">
          {compact ? (
            <M3eMenuItem onClick={() => setSheet("device")}>
              <M3eIcon slot="icon" name={icon} />
              機種: {spec.label}
            </M3eMenuItem>
          ) : (
            <M3eMenuItem>
              <M3eIcon slot="icon" name={icon} />
              機種: {spec.label}
              <M3eMenuTrigger htmlFor={`${id}-device`} />
            </M3eMenuItem>
          )}
          {hasColor ? (
            compact ? (
              <M3eMenuItem onClick={() => setSheet("color")}>
                <M3eIcon slot="icon" name="palette" />
                本体の色: {curColor.label}
              </M3eMenuItem>
            ) : (
              <M3eMenuItem>
                <M3eIcon slot="icon" name="palette" />
                本体の色: {curColor.label}
                <M3eMenuTrigger htmlFor={`${id}-color`} />
              </M3eMenuItem>
            )
          ) : null}
          {hasView ? (
            <>
              <M3eDivider />
              <M3eMenuItemGroup aria-label="表示">
                {(
                  [
                    ["post", "投稿で見る", "image"],
                    ["grid", "プロフィールで見る", "grid_view"],
                  ] as const
                ).map(([v, l]) => (
                  <M3eMenuItemRadio key={v} checked={view === v} onClick={() => onView(v)}>
                    {l}
                  </M3eMenuItemRadio>
                ))}
              </M3eMenuItemGroup>
            </>
          ) : null}
          {hasSafe ? (
            <>
              <M3eDivider />
              <M3eMenuItemCheckbox checked={safeArea} onClick={() => onSafeArea(!safeArea)}>
                安全領域を表示
              </M3eMenuItemCheckbox>
            </>
          ) : null}
          {onFullscreen ? (
            <>
              <M3eDivider />
              <M3eMenuItem onClick={onFullscreen}>
                <M3eIcon slot="icon" name="fullscreen" />
                全画面で見る
              </M3eMenuItem>
            </>
          ) : null}
        </M3eMenu>
        {compact ? null : (
          <>
            {deviceMenu}
            {hasColor ? (
              <M3eMenu id={`${id}-color`} positionX="before">
                {colors.map((c) => (
                  <M3eMenuItemRadio
                    key={c.id}
                    checked={c.id === curColor.id}
                    onClick={() => onDevice({ device: spec.id, color: c.id })}
                  >
                    {c.label}
                  </M3eMenuItemRadio>
                ))}
              </M3eMenu>
            ) : null}
          </>
        )}
      </AppBarSlot>
      {compact ? sheets : null}
    </>
  );
}
