import { api } from "@mf100/convex/api";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { M3eFilterChipElement } from "@m3e/web/chips";
import { useEffect, useRef, useState } from "react";
import { NewWorkDialog } from "@/features/work/NewWorkDialog";
import { WorksByTeam } from "@/features/work/WorksByTeam";
import { lifecycleLabel } from "@/lib/labels";
import { useWindowClass } from "@/lib/useMedia";
import { AppBarSlot } from "@/ui/AppBarSlot";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import {
  M3eFilterChip,
  M3eFilterChipSet,
  M3eIcon,
  M3eIconButton,
  M3eMenu,
  M3eMenuItemGroup,
  M3eMenuItemRadio,
  M3eMenuTrigger,
} from "@/ui/m3e";

export const Route = createFileRoute("/_app/works/")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { q?: string; new?: boolean; by?: "production" } => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(s.new === true || s.new === "true" ? { new: true } : {}),
    ...(s.by === "production" ? { by: "production" as const } : {}),
  }),
  component: Works,
});

/**
 * U-02 制作物一覧。探して開くだけの入口。行を押すとエディタ（最新版）が開く。
 * 「局 › 担当」の入れ子で出し、主管担当／制作担当のどちらの下に並べるかを切り替える（`by`。既定は主管担当。
 * 利用者決定 2026-10-15）。PC もスマホも M3E の入れ子のリスト（WorksByTeam。M3 に表の部品が無いので揃えた。利用者決定 2026-10-16）。
 * 制作物の登録は管理者が一括で行う（§36。利用者決定 2026-10-15）ので、FAB は「版を提出」に譲り、1 件ずつの登録は
 * 登録の権限（Nogiku の組織権限 works:create）のある人にだけ、アプリバーの操作として出す（ダイアログは `?new=1`）。
 * 検索語は `q` で渡る（検索バーは一旦外している）。見出し「制作物一覧」は共通アプリバーに差し込む（M3 App bars）。
 */
function Works() {
  const { q, new: creating, by } = Route.useSearch();
  const axis = by ?? "owner";
  const navigate = useNavigate();
  const me = useQuery(api.me.me, {});
  const teams = useQuery(api.teams.list, {});
  const [lifecycle, setLifecycle] = useState<string>("");
  const compact = useWindowClass() === "compact";
  // 「制作物を登録」はレールの FAB にある（compact にはレールが無い）
  const canRegister = !compact;
  const setAxis = (next: "owner" | "production") =>
    void navigate({
      to: "/works",
      search: (s) => {
        const { by: _drop, ...rest } = s;
        return next === "production" ? { ...rest, by: "production" as const } : rest;
      },
      replace: true,
    });
  const works = useQuery(api.works.listMine, {
    ...(q ? { text: q } : {}),
    ...(lifecycle ? { lifecycle: lifecycle as "active" } : {}),
  });
  const setCreating = (on: boolean) =>
    void navigate({
      to: "/works",
      search: (s) => {
        const { new: _drop, ...rest } = s;
        return on ? { ...rest, new: true } : rest;
      },
      replace: !on,
    });

  return (
    <div className="works">
      <AppBarSlot slot="title">制作物一覧</AppBarSlot>
      {me?.canCreateWorks ? (
        <AppBarSlot slot="actions">
          <M3eIconButton
            aria-label="制作物を登録"
            title="制作物を登録"
            onClick={() => setCreating(true)}
          >
            <M3eIcon name="note_add" />
          </M3eIconButton>
        </AppBarSlot>
      ) : null}
      <div className="works__controls">
        <M3eFilterChipSet aria-label="状態で絞り込み" className="works__filters">
          {(["active", "on_hold", "finalized"] as const).map((k) => (
            <M3eFilterChip
              key={k}
              selected={lifecycle === k}
              onClick={() => setLifecycle((cur) => (cur === k ? "" : k))}
            >
              {lifecycleLabel[k]}
            </M3eFilterChip>
          ))}
        </M3eFilterChipSet>
        {teams && teams.length > 0 && compact ? (
          <AxisChip axis={axis} onChange={setAxis} />
        ) : teams && teams.length > 0 ? (
          <ChoiceGroup
            label="並べる担当"
            className="works__axis"
            value={axis}
            onChange={setAxis}
            choices={[
              { value: "owner", label: "主管担当" },
              { value: "production", label: "制作担当" },
            ]}
          />
        ) : null}
      </div>
      {works === undefined || teams === undefined ? (
        <p className="muted">読み込み中…</p>
      ) : works.length === 0 ? (
        <div className="empty">
          {q
            ? `「${q}」に一致する制作物はありません`
            : canRegister && !lifecycle
              ? "制作物がありません。「制作物を登録」から登録できます。"
              : "制作物がありません"}
        </div>
      ) : (
        <WorksByTeam
          works={works}
          teams={teams}
          axis={axis}
          compact={compact}
          onOpen={(workId) => void navigate({ to: "/works/$workId", params: { workId } })}
        />
      )}
      <NewWorkDialog
        open={creating === true && me?.canCreateWorks === true}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

const axisLabel = { owner: "主管担当", production: "制作担当" } as const;

/**
 * スマホの「主管担当／制作担当」: 状態のチップと 1 行に収めるため、選んでいる方を名前にしたチップを押すとメニューで選ぶ
 * （M3 Chips: 絞り込みのチップは末尾のアイコンからメニューを開ける。compact はチップ全体で開く）。
 * M3E の filter chip は押すと選択が反転するので、押した後に戻す（並べ方の切り替えで、絞り込みのオン・オフではない）。
 * 読み上げでは「メニューを開くボタン」にする（M3E は radio にするが、radio には aria-expanded を付けられない）
 */
function AxisChip({
  axis,
  onChange,
}: {
  axis: "owner" | "production";
  onChange: (next: "owner" | "production") => void;
}) {
  const ref = useRef<M3eFilterChipElement>(null);
  useEffect(() => {
    const chip = ref.current;
    if (!chip) return;
    const fix = () => {
      if (chip.getAttribute("role") !== "button") chip.setAttribute("role", "button");
      if (chip.hasAttribute("aria-checked")) chip.removeAttribute("aria-checked");
    };
    fix();
    const mo = new MutationObserver(fix);
    mo.observe(chip, { attributes: true, attributeFilter: ["role", "aria-checked"] });
    return () => mo.disconnect();
  }, []);
  return (
    <>
      <M3eFilterChip
        ref={ref}
        className="works__axis-chip"
        aria-label={`並べる担当: ${axisLabel[axis]}（変える）`}
        onClick={() =>
          requestAnimationFrame(() => {
            if (ref.current) ref.current.selected = false;
          })
        }
      >
        {axisLabel[axis]}
        <M3eIcon slot="trailing-icon" name="arrow_drop_down" />
        <M3eMenuTrigger htmlFor="works-axis-menu" />
      </M3eFilterChip>
      <M3eMenu id="works-axis-menu">
        <M3eMenuItemGroup aria-label="並べる担当">
          {(["owner", "production"] as const).map((k) => (
            <M3eMenuItemRadio key={k} checked={axis === k} onClick={() => onChange(k)}>
              {axisLabel[k]}
            </M3eMenuItemRadio>
          ))}
        </M3eMenuItemGroup>
      </M3eMenu>
    </>
  );
}
