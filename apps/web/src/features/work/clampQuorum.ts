/** 「校了とみなす人数」の入力を 1..校了者の数に収める（空・読めない値は 1）。業務規則の本体はサーバー（domain の normalizeApprovalSetup） */
export function clampQuorum(raw: string | number, approvers: number): number {
  const n = typeof raw === "number" ? raw : Number(raw.normalize("NFKC").trim());
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(Math.trunc(n), 1), Math.max(approvers, 1));
}
