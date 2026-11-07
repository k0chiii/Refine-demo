// 差分テストの比べ方: 戻りの正規化（ID・名前の差の吸収）、差分の収集、許す差の突き合わせ。

/**
 * ID の形: UUID（Cloudflare）、convex-test の ID（`000000000000010050commentThreads`: 数字 + 表の名前）、
 * 本物の Convex の ID（base32 の 32 文字）。文字列の途中（複合キー・URL）にも現れるので全て置き換える
 */
const ID_SHAPE =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{12,}[A-Za-z]+|[0-9a-hjkmnp-tv-z]{32})\b/g;

/** ID に付ける名前。手順が覚えたもの（$work など）が先、知らないものは出現順の id#N */
export class IdNames {
  private readonly names = new Map<string, string>();
  private unknown = 0;
  know(id: string, name: string) {
    if (!this.names.has(id)) this.names.set(id, name);
  }
  /** 値の中の ID らしい文字列（途中に埋まったものも）を名前に置き換える */
  replace(text: string): string {
    return text.replace(ID_SHAPE, (id) => {
      let name = this.names.get(id);
      if (!name) {
        name = `id#${++this.unknown}`;
        this.names.set(id, name);
      }
      return name;
    });
  }
  /** 手順の save した値に含まれる ID に、パスで名前を付ける */
  learn(value: unknown, path: string) {
    if (typeof value === "string") {
      for (const id of value.match(ID_SHAPE) ?? []) this.know(id, `$${path}`);
    } else if (Array.isArray(value)) value.forEach((v, i) => this.learn(v, `${path}.${i}`));
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value).sort(byKey)) this.learn(v, `${path}.${k}`);
  }
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 戻りを両側で比べられる形にする。
 * - Convex の行の `_id` は `id` に、`_creationTime` は捨てる（admin:auditLog は Cloudflare も `_id` で返す）
 * - 鍵は辞書順に並べる（ID の番号づけが鍵の順に左右されないように）
 * - undefined の鍵は無いものとして扱う（Convex も JSON も捨てる）
 */
export function normalize(value: unknown, names: IdNames): unknown {
  if (typeof value === "string") return names.replace(value);
  if (Array.isArray(value)) return value.map((v) => normalize(v, names));
  if (value && typeof value === "object") {
    const entries: [string, unknown][] = [];
    for (const [key, v] of Object.entries(value).sort(byKey)) {
      if (v === undefined) continue;
      if (key === "_creationTime") continue;
      entries.push([key === "_id" ? "id" : key, v]);
    }
    return Object.fromEntries(
      entries.sort(byKey).map(([k, v]) => [k, normalize(v, names)] as const),
    );
  }
  return value;
}

export interface Diff {
  step: number;
  by: string;
  call: string;
  path: string;
  convex: unknown;
  cloudflare: unknown;
}

const MISSING = Symbol("missing");
const show = (v: unknown): string => (v === MISSING ? "(なし)" : (JSON.stringify(v) ?? String(v)));

/** 2 つの正規化済みの値を突き合わせ、違う葉ごとに 1 行を積む（片側にだけある部分木は、その根で 1 行） */
export function diffValues(
  convex: unknown,
  cloudflare: unknown,
  path: string,
  into: (path: string, convex: unknown, cloudflare: unknown) => void,
) {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (Array.isArray(convex) && Array.isArray(cloudflare)) {
    for (let i = 0; i < Math.max(convex.length, cloudflare.length); i++)
      diffValues(
        i < convex.length ? convex[i] : MISSING,
        i < cloudflare.length ? cloudflare[i] : MISSING,
        `${path}.${i}`,
        into,
      );
  } else if (isObj(convex) && isObj(cloudflare)) {
    for (const key of new Set([...Object.keys(convex), ...Object.keys(cloudflare)]))
      diffValues(
        key in convex ? convex[key] : MISSING,
        key in cloudflare ? cloudflare[key] : MISSING,
        `${path}.${key}`,
        into,
      );
  } else if (show(convex) !== show(cloudflare)) into(path, convex, cloudflare);
}

/** 許す差。pattern は `呼び出し名.パス`。`*` はドットを含まない 1 区切り、`**` はドットも含めた何でも */
export interface Allowed {
  pattern: string;
  reason: string;
}

const matcher = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\0")
      .replace(/\*/g, "[^.]*")
      .replace(/\0/g, ".*")}$`,
  );

export function splitAllowed(diffs: readonly Diff[], allowed: readonly Allowed[]) {
  const matchers = allowed.map((a) => ({ a, re: matcher(a.pattern), hits: 0 }));
  const unexpected: Diff[] = [];
  for (const d of diffs) {
    const hit = matchers.find((m) => m.re.test(`${d.call}${d.path}`));
    if (hit) hit.hits++;
    else unexpected.push(d);
  }
  return {
    unexpected,
    /** どの差にも当たらなかった許可（直った差の許可が残り続けないように） */
    stale: matchers.filter((m) => m.hits === 0).map((m) => m.a),
  };
}

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 差分を 1 つの表（手順・呼び出し・path・Convex の値・Cloudflare の値）にする */
export function table(diffs: readonly Diff[]): string {
  const rows = diffs.map((d) => [
    `#${d.step}`,
    `${d.by} ${d.call}`,
    d.path || "(root)",
    clip(show(d.convex)),
    clip(show(d.cloudflare)),
  ]);
  return [["step", "call", "path", "convex", "cloudflare"], ...rows]
    .map((r) => r.join("  |  "))
    .join("\n");
}

export { MISSING };
