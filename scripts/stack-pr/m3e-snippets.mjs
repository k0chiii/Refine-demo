/** PR 本文用: Material 3 Expressive 自己レビューの定型（URL は m3.material.io 公式） */
export const M3E_PAGES = {
  buttons:
    "https://m3.material.io/components/buttons/overview",
  buttonGroups:
    "https://m3.material.io/components/button-groups/overview",
  lists: "https://m3.material.io/components/lists/overview",
  cards: "https://m3.material.io/components/cards/overview",
  progress:
    "https://m3.material.io/components/progress-indicators/overview",
  shape: "https://m3.material.io/styles/shape/overview",
  typography: "https://m3.material.io/styles/typography/overview",
  color: "https://m3.material.io/styles/color/the-color-system/color-roles",
  motion: "https://m3.material.io/styles/motion/overview",
  dialogs: "https://m3.material.io/components/dialogs/overview",
  chips: "https://m3.material.io/components/chips/overview",
};

export function m3eSection({ refs, aligned, intentional }) {
  const lines = ["## Material 3 Expressive 自己レビュー", "", "### 参照した公式ページ"];
  for (const r of refs) lines.push(`- ${r}`);
  lines.push("", "### 合っている点");
  for (const a of aligned) lines.push(`- ${a}`);
  lines.push("", "### 意図的に外した点");
  for (const i of intentional) lines.push(`- ${i}`);
  return lines.join("\n");
}

export function decideSection(items) {
  if (!items?.length) return "## 決めること\n\nなし";
  const lines = ["## 決めること", ""];
  for (const it of items) {
    lines.push(`${it.id}. ${it.q}`);
    for (const opt of it.options) {
      const star = opt.rec ? "★ " : "";
      lines.push(`   - ${star}${opt.id}) ${opt.text} — ${opt.note}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
