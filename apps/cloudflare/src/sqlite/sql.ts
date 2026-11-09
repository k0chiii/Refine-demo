/**
 * アダプタが SQLite に求める口はこれだけ。Node の node:sqlite でも Durable Object の ctx.storage.sql でも、
 * 数行で包めるようにして、アダプタ本体をどちらにも依存させない。
 */
export type SqlParam = string | number | null;

export interface Sql {
  /** 同期。SELECT と RETURNING の行を返す（それ以外の文では空配列）。 */
  exec(query: string, ...params: SqlParam[]): Record<string, unknown>[];
}
