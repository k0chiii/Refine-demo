import { orgPermissionCatalog } from "@mf100/domain";

/**
 * Nogiku Access（組織権限）の取得。ログインした本人のアクセストークンで `POST {apiUrl}/permission/check` を呼ぶ。
 * apps/convex の lib/nogikuAccess.ts と同じ振る舞い。
 * ponytail: Convex 側と二重管理。Convex を畳むときにこちらへ一本化する
 */
export interface NogikuAccessConfig {
  /** 末尾スラッシュなし */
  apiUrl: string;
  organization: string;
  systemId: string;
}

/** ログインを待たせすぎない上限。超えたら保存値を変えずに先へ進む */
const TIMEOUT_MS = 5000;

export function readNogikuAccessConfig(env: {
  NOGIKU_ACCESS_API_URL?: string | undefined;
  NOGIKU_ACCESS_ORG_SLUG?: string | undefined;
  NOGIKU_ACCESS_SYSTEM_ID?: string | undefined;
}): NogikuAccessConfig | undefined {
  const apiUrl = env.NOGIKU_ACCESS_API_URL?.replace(/\/+$/, "");
  const organization = env.NOGIKU_ACCESS_ORG_SLUG;
  const systemId = env.NOGIKU_ACCESS_SYSTEM_ID;
  if (apiUrl && organization && systemId) return { apiUrl, organization, systemId };
  return undefined;
}

/**
 * 持っている組織権限名。取れなかったとき（通信・非 2xx・形の違う応答・時間切れ）は undefined で、投げない。
 * 呼ぶ側は undefined を「保存済みの権限を変えない」と扱う。
 */
export async function fetchOrgPermissions(
  config: NogikuAccessConfig,
  accessToken: string,
  fetchImpl: typeof fetch,
  timeoutMs: number = TIMEOUT_MS,
): Promise<string[] | undefined> {
  const requested: string[] = orgPermissionCatalog.map((p) => p.name);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${config.apiUrl}/permission/check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        organization: config.organization,
        systemId: config.systemId,
        permissions: requested,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    const { valid, missing } = (body ?? {}) as { valid?: unknown; missing?: unknown };
    // valid と missing が食い違う応答から権限を導くと、全権限を付けてしまうことがある
    if (
      typeof valid !== "boolean" ||
      !Array.isArray(missing) ||
      !missing.every((m) => typeof m === "string" && requested.includes(m)) ||
      valid !== (missing.length === 0)
    )
      return undefined;
    return requested.filter((name) => !missing.includes(name));
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
