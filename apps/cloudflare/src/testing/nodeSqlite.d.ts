/**
 * テストが使う node:sqlite の分だけの型。@types/node を入れると Workers の型（worker-configuration.d.ts）と
 * グローバルが衝突するので、ここに必要な口だけ書く。
 */
declare module "node:sqlite" {
  export class StatementSync {
    all(...params: (string | number | null)[]): Record<string, unknown>[];
  }
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
