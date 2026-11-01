import { useState } from "react";
import { ChoiceGroup } from "@/ui/ChoiceGroup";

/** ホームの見え方（ロール名は出さない。アイコンだけ）: 個人＝自分の制作、共同＝制作物の状況、確認＝校了・専門確認 */
export type HomeView = "personal" | "collaboration" | "verified";

const STORAGE_KEY = "mf100.homeView";

const choices = [
  { value: "personal" as const, label: "個人", icon: "person" },
  { value: "collaboration" as const, label: "共同", icon: "groups" },
  { value: "verified" as const, label: "確認", icon: "verified" },
] as const;

function readStored(): HomeView | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return choices.some((c) => c.value === v) ? (v as HomeView) : null;
  } catch {
    return null;
  }
}

/** 画面上にロール名を出さないビュー切替（decisions 38A）。自分で選んだときだけ sessionStorage に覚える */
export function ViewSwitcher({
  value,
  onChange,
}: {
  value?: HomeView;
  onChange?: (next: HomeView) => void;
} = {}) {
  const [internal, setInternal] = useState<HomeView>(() => readStored() ?? "personal");
  const current = value ?? internal;
  const set = (next: HomeView) => {
    setInternal(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
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

/** 覚えている見え方（無ければ null。画面が中身から既定を決める） */
export function storedHomeView(): HomeView | null {
  return readStored();
}
