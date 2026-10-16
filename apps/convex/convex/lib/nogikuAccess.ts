import { orgPermissionCatalog } from "@mf100/domain";

/**
 * Nogiku Access（組織権限）の取得。ログインしたユーザー本人のアクセストークンで
 * `POST {apiUrl}/permission/check` を呼ぶ。Access Engine が API キーに対応したら、この 1 ファイルを差し替える。
 *
 * 3 つの値が揃ったときだけ連携が有効。resource・scope・endpoint はすべて apiUrl から導く。
 */
export interface NogikuAccessConfig {
  /** 例 https://engine.nogiku.jp/api（末尾スラッシュなし） */
  apiUrl: string;
  /** 組織スラッグ */
  organization: string;
  /** Access に登録した MF100 のシステム ID */
  systemId: string;
}

/** ログインを待たせすぎない上限。超えたら保存値を変えずに先へ進む。 */
const TIMEOUT_MS = 5000;

export function readNogikuAccessConfig(
  env: Record<string, string | undefined>,
): NogikuAccessConfig | undefined {
  const apiUrl = env.NOGIKU_ACCESS_API_URL?.replace(/\/+$/, "");
  const organization = env.NOGIKU_ACCESS_ORG_SLUG;
  const systemId = env.NOGIKU_ACCESS_SYSTEM_ID;
  if (apiUrl && organization && systemId) return { apiUrl, organization, systemId };
  if (apiUrl || organization || systemId)
    console.warn(
      "NOGIKU_ACCESS_API_URL / NOGIKU_ACCESS_ORG_SLUG / NOGIKU_ACCESS_SYSTEM_ID が揃っていないため、組織権限の取得は無効",
    );
  return undefined;
}

/**
 * 持っている組織権限名を返す。取得できなかったとき（ネットワーク・非 2xx・形の合わない応答・タイムアウト）は
 * undefined を返し、throw しない。呼び出し側は undefined を「保存値を変えない」として扱う。
 */
export async function fetchOrgPermissions(
  config: NogikuAccessConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_MS,
): Promise<string[] | undefined> {
  const requested = orgPermissionCatalog.map((p) => p.name);
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
    if (!res.ok) {
      console.warn(`Nogiku Access permission/check failed: ${res.status}`);
      return undefined;
    }
    const body: unknown = await res.json();
    const { valid, missing } = (body ?? {}) as { valid?: unknown; missing?: unknown };
    if (
      typeof valid !== "boolean" ||
      !Array.isArray(missing) ||
      !missing.every((m) => typeof m === "string")
    ) {
      console.warn("Nogiku Access permission/check returned an unexpected body");
      return undefined;
    }
    return requested.filter((name) => !missing.includes(name));
  } catch (error) {
    console.warn("Nogiku Access permission/check failed", error);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
