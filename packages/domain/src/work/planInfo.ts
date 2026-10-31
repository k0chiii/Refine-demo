import { DomainError } from "../shared/DomainError.ts";

/** 登録済み企画情報（decisions 69–72。Notion 外の MF100 項目） */
export type RegisteredPlanInfo = {
  /** 企画名 */
  name?: string;
  /** 企画番号 */
  number?: string;
  /** 開催場所 */
  venue?: string;
  /** 開催日時（表示用の自由記述。例: 5/24(土) 10:00–17:00） */
  schedule?: string;
};

export const planInfoFields = ["name", "number", "venue", "schedule"] as const;
export type PlanInfoField = (typeof planInfoFields)[number];

export const planInfoFieldLabels: Record<PlanInfoField, string> = {
  name: "企画名",
  number: "企画番号",
  venue: "開催場所",
  schedule: "開催日時",
};

export const PLAN_INFO_BOT_ID = "bot:plan-info";

const MAX_LEN = 200;

function trimField(value: string | null | undefined, field: PlanInfoField): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  const s = value.trim();
  if (s === "") return undefined;
  if (Array.from(s).length > MAX_LEN)
    throw new DomainError("invalid_argument", { field, reason: "too_long", max: MAX_LEN });
  return s;
}

/** 企画情報の正規化。undefined=触らない、null=消す */
export function normalizeRegisteredPlanInfo(
  input: Partial<Record<PlanInfoField, string | null | undefined>>,
): RegisteredPlanInfo | null | undefined {
  const out: RegisteredPlanInfo = {};
  let any = false;
  for (const k of planInfoFields) {
    if (input[k] === undefined) continue;
    const v = trimField(input[k], k);
    if (v !== undefined) {
      out[k] = v;
      any = true;
    }
  }
  if (Object.keys(input).some((k) => planInfoFields.includes(k as PlanInfoField) && input[k as PlanInfoField] === null))
    return any ? out : null;
  return any ? out : undefined;
}

export type PlanInfoCheckItem = {
  field: PlanInfoField;
  ok: boolean;
  registered: string;
  /** 版本文側で見つかった抜粋（無ければ空） */
  excerpt?: string;
  message: string;
};

/** 項目ごとのヒューリスティック照合（AI 前処理 / フォールバック。decision 70A） */
export function checkRegisteredPlanInfoInText(
  text: string,
  info: RegisteredPlanInfo,
): PlanInfoCheckItem[] {
  const body = text.normalize("NFKC");
  const items: PlanInfoCheckItem[] = [];
  for (const field of planInfoFields) {
    const registered = info[field]?.trim();
    if (!registered) continue;
    const needle = registered.normalize("NFKC");
    const ok = body.includes(needle);
    items.push({
      field,
      ok,
      registered,
      excerpt: ok ? registered : undefined,
      message: ok
        ? `${planInfoFieldLabels[field]}は本文と一致しています`
        : `${planInfoFieldLabels[field]}「${registered}」が本文に見つかりません`,
    });
  }
  return items;
}
