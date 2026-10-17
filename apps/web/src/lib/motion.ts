/**
 * JS でのスクロールの動き。「動きを減らす」設定（prefers-reduced-motion）のときは瞬時に移る（M3 Usability › Motion。§35 A-14）。
 * CSS の動きは styles.css と M3E が同じ設定を見ている
 */
export const scrollBehavior = (): ScrollBehavior =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
