import type { PartOption } from "@humation/core";
import { api } from "@mf100/convex/api";
import type { AvatarConfig } from "@mf100/domain";
import { useMutation } from "convex/react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  AVATAR_COLOR_LABELS,
  AVATAR_COLOR_SLOTS,
  AVATAR_PALETTES,
  AVATAR_SLOTS,
  partLabel,
  randomAvatarConfig,
  sanitizeAvatarConfig,
  useHumation,
  type AvatarColorSlot,
  type AvatarSlotId,
  type Humation,
  type Swatch,
} from "@/lib/avatar";
import { toast } from "@/lib/toast";
import { useAction } from "@/lib/useAction";
import { Loading } from "@/ui/Loading";
import { M3eButton, M3eDialog, M3eIcon } from "@/ui/m3e";
import { PaneTabs } from "@/ui/PaneTabs";

/** 選択画面の中の状態（部位はすべて部品の ID で確定している） */
interface Draft {
  selections: Record<string, string>;
  colors: Record<string, string>;
  background: string;
}

type Tab = AvatarSlotId | "colors";

/** 保存値（または無し）から、画面の状態を作る。seed から決まる部位も ID に確定する */
function resolveDraft(hm: Humation, baseSeed: string, config: AvatarConfig | null): Draft {
  const safe = sanitizeAvatarConfig(hm, config);
  const json = hm.core
    .createAvatar(hm.manifest, {
      seed: safe?.seed ?? baseSeed,
      ...(safe?.selections ? { selections: safe.selections } : {}),
      ...(safe?.colors ? { colors: safe.colors } : {}),
      ...(safe?.background ? { background: safe.background } : {}),
    })
    .toJSON();
  const colors: Record<string, string> = {};
  for (const slot of AVATAR_COLOR_SLOTS)
    colors[slot] = json.colors[slot] ?? hm.manifest.defaults.colors[slot] ?? "000000";
  return {
    selections: json.selections,
    colors,
    background:
      json.background === "transparent" ? hm.manifest.defaults.background : json.background,
  };
}

const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

/**
 * アバターを変える（Humation。利用者指示 2026-10-17「Humation のアバター選択画面もつけて欲しい」）。
 * 上に大きなプレビュー、「おまかせ」（新しい種と候補の色）と「元に戻す」、部位ごとのタブに部品の一覧（その部品だけ替えた小さな絵）、
 * 「色」のタブに役割ごとの色の候補と背景。保存はアカウントごと（PC とスマホで共通）。
 * compact は全画面、それ以上は普通のダイアログ（M3 Dialogs › Full-screen dialog）。
 * 部品の一覧は 1 つを選ぶ radiogroup（矢印キーで移り、選んだものだけ Tab で止まる）。小さな絵は `<use>` で部品を参照し、
 * 43 個並べても DOM を膨らませない（部品の定義は PartDefs に 1 回だけ置く）。
 */
export function AvatarPickerDialog({
  open,
  onClose,
  me,
}: {
  open: boolean;
  onClose: () => void;
  me: { id: string; email: string | null; name: string; avatar: AvatarConfig | null };
}) {
  const hm = useHumation();
  const setAvatar = useMutation(api.me.setAvatar);
  const baseSeed = me.email ?? me.id;
  const [initial, setInitial] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Tab>("head");
  useEffect(() => {
    if (!open || !hm) return;
    const d = resolveDraft(hm, baseSeed, me.avatar);
    setInitial(d);
    setDraft(d);
    setTab("head");
    // 開いたときの保存値だけを基準にする（開いている間に me が更新されても画面は動かさない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hm]);

  const dirty = Boolean(draft && initial && !sameDraft(draft, initial));
  const save = useAction(async () => {
    if (!hm || !draft) return;
    const name = (id: string) => hm.manifest.parts.find((p) => p.id === id)?.name ?? id;
    await setAvatar({
      avatar: {
        selections: Object.fromEntries(
          Object.entries(draft.selections).map(([slot, id]) => [slot, name(id)]),
        ),
        colors: draft.colors,
        background: draft.background,
      },
    });
    toast("アバターを保存しました");
    onClose();
  });
  const clear = useAction(async () => {
    await setAvatar({ avatar: null });
    toast("アバターを既定（メールアドレスから決まる絵）に戻しました");
    onClose();
  });
  const shuffle = () => {
    if (!hm || !draft) return;
    const r = randomAvatarConfig();
    const json = hm.core.createAvatar(hm.manifest, { seed: r.seed }).toJSON();
    setDraft({
      selections: json.selections,
      colors: { ...draft.colors, ...r.colors },
      background: r.background,
    });
  };
  const pending = save.pending || clear.pending;

  return (
    <M3eDialog
      open={open}
      onClosed={onClose}
      closeLabel="閉じる"
      className="dialog--full avatar-picker"
    >
      <span slot="header">アバターを変える</span>
      <div className="dialog-body avatar-picker__body">
        {!hm || !draft ? (
          <Loading label="アバターの部品を読み込んでいます" className="avatar-picker__loading" />
        ) : (
          <>
            <div className="avatar-picker__preview">
              <hm.Avatar
                assets={hm.manifest}
                selections={draft.selections}
                colors={draft.colors}
                background={draft.background}
                size={152}
                title={`${me.name} のアバターのプレビュー`}
                className="user-avatar avatar-picker__big"
              />
              <div className="avatar-picker__preview-actions">
                <M3eButton variant="tonal" onClick={shuffle}>
                  <M3eIcon slot="icon" name="shuffle" />
                  おまかせ
                </M3eButton>
                <M3eButton
                  variant="text"
                  disabled={!dirty}
                  onClick={() => initial && setDraft(initial)}
                >
                  <M3eIcon slot="icon" name="undo" />
                  元に戻す
                </M3eButton>
              </div>
            </div>
            <PaneTabs<Tab>
              label="変える部位"
              value={tab}
              onChange={setTab}
              items={[...AVATAR_SLOTS, { id: "colors", label: "色" }]}
              stretch
            />
            {tab === "colors" ? (
              <ColorsPane draft={draft} onChange={setDraft} />
            ) : (
              <PartsPane
                hm={hm}
                slot={tab}
                draft={draft}
                onPick={(id) =>
                  setDraft((d) => d && { ...d, selections: { ...d.selections, [tab]: id } })
                }
              />
            )}
          </>
        )}
      </div>
      <div slot="actions" className="row">
        {me.avatar ? (
          <M3eButton variant="text" disabled={pending} onClick={() => void clear.run()}>
            既定に戻す
          </M3eButton>
        ) : null}
        <span className="spacer" />
        <M3eButton variant="text" onClick={onClose}>
          キャンセル
        </M3eButton>
        <M3eButton variant="filled" disabled={pending || !dirty} onClick={() => void save.run()}>
          保存する
        </M3eButton>
      </div>
    </M3eDialog>
  );
}

// ---------------------------------------------------------------- 部品の一覧

/** 部品の SVG を <use> で参照できる形（id は部品ごとに名前空間を付け、ほかの部品の clipPath 等と混ざらないように） */
function partDef(hm: Humation, part: PartOption): string {
  const layer = part.layers[0];
  const slot = hm.manifest.layerSlots.find((l) => l.id === layer?.layerSlot);
  if (!layer?.svg || !slot) return "";
  const prefix = `hm-${part.id}`;
  const inner = layer.svg
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}-${id})`)
    .replace(/\bhref="#([^"]+)"/g, (_m, id: string) => `href="#${prefix}-${id}"`);
  return `<g id="hm-part-${part.id}" transform="translate(${slot.offset.x}, ${slot.offset.y})">${inner}</g>`;
}

/** 一覧に出る部品と、いま選んでいる部品の定義（画面に 1 つ。見えない svg の中） */
const PartDefs = memo(function PartDefs({ hm, parts }: { hm: Humation; parts: PartOption[] }) {
  const html = useMemo(() => parts.map((p) => partDef(hm, p)).join(""), [hm, parts]);
  return (
    <svg className="avatar-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs dangerouslySetInnerHTML={{ __html: html }} />
    </svg>
  );
});

function cssColors(colors: Record<string, string>): CSSProperties {
  const style: Record<string, string> = {};
  for (const [slot, hex] of Object.entries(colors)) style[`--hm-${slot}`] = `#${hex}`;
  return style as CSSProperties;
}

/** 小さな絵（選んでいる部品のうち 1 つだけ替えたもの）。部品は PartDefs を参照する */
const Thumb = memo(function Thumb({
  hm,
  selections,
  colors,
  background,
  size,
}: {
  hm: Humation;
  selections: Record<string, string>;
  colors: Record<string, string>;
  background: string;
  size: number;
}) {
  const crop = hm.manifest.crops[hm.manifest.defaults.crop]!;
  const order = new Map(hm.manifest.layerSlots.map((l) => [l.id, l.order]));
  const ids = Object.values(selections).sort((a, b) => {
    const la = hm.manifest.parts.find((p) => p.id === a)?.layers[0]?.layerSlot ?? "";
    const lb = hm.manifest.parts.find((p) => p.id === b)?.layers[0]?.layerSlot ?? "";
    return (order.get(la) ?? 0) - (order.get(lb) ?? 0);
  });
  return (
    <svg
      viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
      width={size}
      height={size}
      className="user-avatar avatar-thumb"
      style={cssColors(colors)}
      aria-hidden="true"
      focusable="false"
    >
      <rect x={crop.x} y={crop.y} width={crop.width} height={crop.height} fill={`#${background}`} />
      {ids.map((id) => (
        <use key={id} href={`#hm-part-${id}`} />
      ))}
    </svg>
  );
});

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function PartsPane({
  hm,
  slot,
  draft,
  onPick,
}: {
  hm: Humation;
  slot: string;
  draft: Draft;
  onPick: (partId: string) => void;
}) {
  const parts = useMemo(() => hm.core.getPartsForSlot(hm.manifest, slot), [hm, slot]);
  const label = AVATAR_SLOTS.find((s) => s.id === slot)?.label ?? slot;
  const selected = draft.selections[slot];
  const defs = useMemo(() => {
    const others = Object.values(draft.selections)
      .filter((id) => !parts.some((p) => p.id === id))
      .map((id) => hm.manifest.parts.find((p) => p.id === id))
      .filter((p): p is PartOption => Boolean(p));
    return [...parts, ...others];
  }, [hm, parts, draft.selections]);
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    let j: number;
    const i = parts.findIndex((p) => p.id === selected);
    if (e.key in ARROWS) j = (i + ARROWS[e.key]! + parts.length) % parts.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = parts.length - 1;
    else return;
    e.preventDefault();
    const next = parts[j]!;
    onPick(next.id);
    ref.current
      ?.querySelector<HTMLButtonElement>(`[data-part-id="${CSS.escape(next.id)}"]`)
      ?.focus();
  };
  return (
    <>
      <PartDefs hm={hm} parts={defs} />
      <div
        ref={ref}
        role="radiogroup"
        aria-label={label}
        className="avatar-parts"
        onKeyDown={onKeyDown}
      >
        {parts.map((p) => {
          const on = p.id === selected;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={partLabel(p)}
              tabIndex={on ? 0 : -1}
              data-part-id={p.id}
              className={`avatar-part ${on ? "avatar-part--on" : ""}`}
              onClick={() => onPick(p.id)}
            >
              <Thumb
                hm={hm}
                selections={{ ...draft.selections, [slot]: p.id }}
                colors={draft.colors}
                background={draft.background}
                size={56}
              />
              <span className="avatar-part__label">{partLabel(p)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 色

function ColorsPane({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const rows: Array<{ key: AvatarColorSlot | "background"; value: string }> = [
    ...AVATAR_COLOR_SLOTS.map((k) => ({ key: k, value: draft.colors[k] ?? "000000" })),
    { key: "background" as const, value: draft.background },
  ];
  const set = (key: AvatarColorSlot | "background", hex: string) =>
    onChange(
      key === "background"
        ? { ...draft, background: hex }
        : { ...draft, colors: { ...draft.colors, [key]: hex } },
    );
  return (
    <div className="avatar-colors">
      {rows.map(({ key, value }) => (
        <ColorRow
          key={key}
          id={`avatar-color-${key}`}
          label={AVATAR_COLOR_LABELS[key]}
          swatches={AVATAR_PALETTES[key]}
          value={value}
          onChange={(hex) => set(key, hex)}
        />
      ))}
    </div>
  );
}

function ColorRow({
  id,
  label,
  swatches,
  value,
  onChange,
}: {
  id: string;
  label: string;
  swatches: Swatch[];
  value: string;
  onChange: (hex: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    let j: number;
    const i = swatches.findIndex((s) => s.hex === value);
    if (e.key in ARROWS) j = (Math.max(i, 0) + ARROWS[e.key]! + swatches.length) % swatches.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = swatches.length - 1;
    else return;
    e.preventDefault();
    const next = swatches[j]!;
    onChange(next.hex);
    ref.current?.querySelector<HTMLButtonElement>(`[data-hex="${next.hex}"]`)?.focus();
  };
  const inPalette = swatches.some((s) => s.hex === value);
  return (
    <div className="avatar-colors__row">
      <span id={id} className="label-large avatar-colors__label">
        {label}
      </span>
      <div className="avatar-colors__choices">
        <div
          ref={ref}
          role="radiogroup"
          aria-labelledby={id}
          className="avatar-swatches"
          onKeyDown={onKeyDown}
        >
          {swatches.map((s, i) => {
            const on = s.hex === value;
            return (
              <button
                key={s.hex}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={s.name}
                title={s.name}
                tabIndex={on || (!inPalette && i === 0) ? 0 : -1}
                data-hex={s.hex}
                className={`avatar-swatch ${on ? "avatar-swatch--on" : ""}`}
                style={{ background: `#${s.hex}` }}
                onClick={() => onChange(s.hex)}
              />
            );
          })}
        </div>
        <label className="avatar-colors__custom small">
          <input
            type="color"
            value={`#${value.toLowerCase()}`}
            aria-label={`${label}をほかの色にする`}
            onChange={(e) => onChange(e.target.value.replace(/^#/, "").toUpperCase())}
          />
          ほかの色
        </label>
      </div>
    </div>
  );
}
