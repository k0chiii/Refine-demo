import type { Sql, SqlParam } from "./sql.ts";

/** ID の払い出し。引数はテーブル名（テストが `work_1` のように決まった ID にするため）。 */
export type NewId = (table: string) => string;

/** Workers にも Node にもある。lib に DOM も @types/node も入れていないので、型だけ手で添える。 */
export const randomId: NewId = () =>
  (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();

/** 複数の部品から作る自然キー（利用者×スレッドなど）。 */
export const keyOf = (...parts: string[]): string => parts.join("|");

export function parseDocs<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => JSON.parse(r.doc as string) as T);
}

/** 文書テーブルの読み書き。並びを指定しない問い合わせは書く側が ORDER BY rowid（= 追加順）を付ける。 */
export class Rows<T> {
  constructor(
    readonly sql: Sql,
    readonly name: string,
    readonly newId: NewId = randomId,
  ) {}

  /** `tail` は WHERE 以降（ORDER BY / LIMIT を含む）。 */
  select(tail: string, ...params: SqlParam[]): T[] {
    return parseDocs<T>(this.sql.exec(`SELECT doc FROM ${this.name} ${tail}`, ...params));
  }
  all(): T[] {
    return this.select("ORDER BY rowid");
  }
  /** 追記だけの行（keyless）。 */
  append(value: T): void {
    this.sql.exec(`INSERT INTO ${this.name} (doc) VALUES (?)`, JSON.stringify(value));
  }
  /** 自然キーの行。更新でも rowid（= 並び）は変わらない。 */
  upsert(id: string, value: T): void {
    this.sql.exec(
      `INSERT INTO ${this.name} (id, doc) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET doc = excluded.doc`,
      id,
      JSON.stringify(value),
    );
  }
  delete(id: string): void {
    this.sql.exec(`DELETE FROM ${this.name} WHERE id = ?`, id);
  }
  count(where: string, ...params: SqlParam[]): number {
    const [row] = this.sql.exec(`SELECT count(*) AS n FROM ${this.name} WHERE ${where}`, ...params);
    return Number(row?.n ?? 0);
  }
}

/** doc に id を持つ行。ID の払い出しは書く側（リポジトリ）の仕事。 */
export class Docs<T extends { id: string }> extends Rows<T> {
  get(id: string): T | null {
    return this.select("WHERE id = ?", id)[0] ?? null;
  }
  insert(data: Omit<T, "id">): T {
    const row = { ...(data as object), id: this.newId(this.name) } as T;
    this.sql.exec(`INSERT INTO ${this.name} (id, doc) VALUES (?, ?)`, row.id, JSON.stringify(row));
    return row;
  }
  put(row: T): void {
    const hit = this.sql.exec(
      `UPDATE ${this.name} SET doc = ? WHERE id = ? RETURNING id`,
      JSON.stringify(row),
      row.id,
    );
    if (hit.length === 0) throw new Error(`row not found: ${row.id}`);
  }
}
