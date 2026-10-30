import { useEffect, useState } from "react";
import { ChoiceGroup } from "@/ui/ChoiceGroup";

/** ホームの見え方（ロール名は出さない。アイコンだけ） */
export type HomeView = "personal" | "collaboration" | "verified";

const STORAGE_KEY = "mf100.homeView";

const choices = [
  { value: "personal" as const, label: "個人", icon: "person" },
  { value: "collaboration" as const, label: "共同", icon: "groups" },
  { value: "verified" as const, label: "確認", icon: "verified" },
] as const;

function readStored(): HomeView {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return choices.some((c) => c.value === v) ? (v as HomeView) : "personal";
  } catch {
    return "personal";
  }
}

/** 画面上にロール名を出さないビュー切替（decisions 38A）。選択は sessionStorage に保存 */
export function ViewSwitcher(
  {
    value,
    onChange,
  }: {
    value?: HomeView;
    onChange?: (next: HomeView) => void;
  } = {},
) {
  const [internal, setInternal] = useState<HomeView>(() => readStored());
  const current = value ?? internal;
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, current);
    } catch {
      /* private mode */
    }
  }, [current]);
  const set = (next: HomeView) => {
    setInternal(next);
    onChange?.(next);
  };
  return (
    <ChoiceGroup<HomeView>
      label="ホームの見え方"
      value={current}
      onChange={set}
      className="home-view-switcher"
      choices={choices.map(({ value: v, label, icon }) => ({
        value: v,
        label: <span className="home-view-switcher__sr">{label}</span>,
        icon,
      }))}
    />
  );
}

export function storedHomeView(): HomeView {
  return readStored();
}
