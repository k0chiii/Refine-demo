import { useId, useState } from "react";
import { ActionSheet } from "@/ui/ActionSheet";
import {
  M3eDivider,
  M3eFab,
  M3eFabMenu,
  M3eFabMenuItem,
  M3eFabMenuTrigger,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItem,
  M3eMenuItemCheckbox,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@/ui/m3e";
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
 * 上に並べていた選択欄をやめ、M3 の FAB menu にしまう（利用者指示 2026-10-15。m3.material.io/components/fab-menu を ax で確認）。
 *
 * - FAB の大きさ: compact は基準の FAB（56。M3E の size="small"）、それより広い画面は medium（80）。窓の右下から 16／24
 * - compact: FAB を押すと FAB menu（項目 2〜6、ラベル＋アイコン、FAB は閉じるボタンに変わる）。
 *   機種・色のように選択肢が多いものは、項目からボトムシートを開いて選ぶ
 * - それより広い画面: 「web では FAB menu に menu を使う」（Adaptive layout）に従い、FAB から M3E menu を開く。
 *   機種・色はサブメニューのラジオ、表示はラジオ、安全領域はチェック
 * - 浮遊ツールバーのある画面（校正画面）は「FAB menu を toolbar と一緒に使わない」ので、
 *   `placement="inline"` でプレビューの右上のアイコンボタンから同じ menu を開く
 * - 項目が 1 つしかない（機種だけ）ときは menu にせず、機種の選択を直接開く（1 項目の FAB menu は使わない）
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
  placement = "fab",
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
  placement?: "fab" | "inline";
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

  // compact の FAB: FAB menu（機種・色はボトムシート）
  if (compact && placement === "fab") {
    if (single)
      return (
        <>
          <div className="preview-fab">
            <M3eFab
              variant="secondary"
              size="small"
              aria-label="機種を選ぶ"
              onClick={() => setSheet("device")}
            >
              <M3eIcon name={icon} />
            </M3eFab>
          </div>
          {sheets}
        </>
      );
    return (
      <>
        <div className="preview-fab">
          <M3eFab variant="secondary" size="small" aria-label={label}>
            <M3eIcon name="tune" />
            <M3eFabMenuTrigger htmlFor={`${id}-fab`} />
          </M3eFab>
        </div>
        <M3eFabMenu id={`${id}-fab`} variant="secondary">
          {onFullscreen ? (
            <M3eFabMenuItem onClick={onFullscreen}>
              <M3eIcon slot="icon" name="fullscreen" />
              全画面で見る
            </M3eFabMenuItem>
          ) : null}
          {hasView ? (
            <M3eFabMenuItem onClick={() => onView(view === "post" ? "grid" : "post")}>
              <M3eIcon slot="icon" name={view === "post" ? "grid_view" : "image"} />
              {view === "post" ? "プロフィールで見る" : "投稿で見る"}
            </M3eFabMenuItem>
          ) : null}
          {hasSafe ? (
            <M3eFabMenuItem onClick={() => onSafeArea(!safeArea)}>
              <M3eIcon slot="icon" name="crop_free" />
              {safeArea ? "安全領域を隠す" : "安全領域を表示"}
            </M3eFabMenuItem>
          ) : null}
          {hasColor ? (
            <M3eFabMenuItem onClick={() => setSheet("color")}>
              <M3eIcon slot="icon" name="palette" />
              本体の色: {curColor.label}
            </M3eFabMenuItem>
          ) : null}
          <M3eFabMenuItem onClick={() => setSheet("device")}>
            <M3eIcon slot="icon" name={icon} />
            機種: {spec.label}
          </M3eFabMenuItem>
        </M3eFabMenu>
        {sheets}
      </>
    );
  }

  // それより広い画面（または浮遊ツールバーのある画面）: FAB / アイコンボタンから M3E menu
  const deviceMenu = (menuId: string) => (
    <M3eMenu id={menuId} positionY={placement === "fab" ? "above" : "below"} positionX="before">
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
  const trigger = (menuId: string, aria: string, iconName: string) =>
    placement === "fab" ? (
      <div className="preview-fab">
        <M3eFab variant="secondary" size={compact ? "small" : "medium"} aria-label={aria}>
          <M3eIcon name={iconName} />
          <M3eMenuTrigger htmlFor={menuId} />
        </M3eFab>
      </div>
    ) : (
      <M3eIconButton variant="tonal" aria-label={aria} className="preview-settings__button">
        <M3eIcon name={iconName} />
        <M3eMenuTrigger htmlFor={menuId} />
      </M3eIconButton>
    );

  if (single)
    return (
      <>
        {trigger(`${id}-device`, "機種を選ぶ", icon)}
        {deviceMenu(`${id}-device`)}
      </>
    );
  return (
    <>
      {trigger(`${id}-menu`, label, "tune")}
      <M3eMenu
        id={`${id}-menu`}
        positionY={placement === "fab" ? "above" : "below"}
        positionX="before"
      >
        <M3eMenuItem>
          <M3eIcon slot="icon" name={icon} />
          機種: {spec.label}
          <M3eMenuTrigger htmlFor={`${id}-device`} />
        </M3eMenuItem>
        {hasColor ? (
          <M3eMenuItem>
            <M3eIcon slot="icon" name="palette" />
            本体の色: {curColor.label}
            <M3eMenuTrigger htmlFor={`${id}-color`} />
          </M3eMenuItem>
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
      {deviceMenu(`${id}-device`)}
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
  );
}
