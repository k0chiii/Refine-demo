/**
 * Convex の読み取り（ドキュメント数・バイト数）を、convex-test の syscall の層で数える。
 * 本番の課金軸（databaseReadDocuments / databaseReadBytes）に近い値を、表ごとの内訳つきで出すための道具。
 * 注意: convex-test は `.filter()` を索引の走査の前に済ませるので、フィルタで落ちた行は数えない（本番は走査した行も読み取りに入る）。
 * バイト数は JSON の長さ（本番の計上とぴったりは一致しない。同じ道具どうしの比較用）。
 */
export interface TableReads {
  docs: number;
  bytes: number;
}
export interface ReadProfile extends TableReads {
  /** 索引の範囲・ページの読み取りを始めた回数（点読みの get は含めない） */
  ranges: number;
  byTable: Record<string, TableReads>;
  /** 書込み（insert / patch / replace / delete）の回数。表ごと（変わらない書込みを書かないことの見張り用） */
  writes: Record<string, number>;
}

const WRITE_OPS = new Set(["1.0/insert", "1.0/shallowMerge", "1.0/replace", "1.0/remove"]);

interface Syscalls {
  syscall: (op: string, args: string) => string;
  asyncSyscall: (op: string, args: string) => Promise<string>;
  jsSyscall: unknown;
}

let active: ReadProfile | null = null;
let installed = false;

function tableOf(id: unknown): string {
  return typeof id === "string" ? id.replace(/^[0-9]+/, "") : "?";
}

function add(doc: unknown) {
  if (!active || doc === null || typeof doc !== "object") return;
  const table = tableOf((doc as { _id?: unknown })._id);
  const bytes = JSON.stringify(doc).length;
  const row = (active.byTable[table] ??= { docs: 0, bytes: 0 });
  row.docs++;
  row.bytes += bytes;
  active.docs++;
  active.bytes += bytes;
}

function decode(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function install() {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as { Convex: Syscalls };
  const real = g.Convex;
  g.Convex = {
    get syscall() {
      const s = real.syscall;
      return (op: string, args: string) => {
        if (op === "1.0/queryStream" && active) active.ranges++;
        return s(op, args);
      };
    },
    get asyncSyscall() {
      const a = real.asyncSyscall;
      return async (op: string, args: string) => {
        const out = await a(op, args);
        if (!active) return out;
        if (WRITE_OPS.has(op)) {
          const parsed = decode(args);
          const table = parsed?.table ?? tableOf(parsed?.id);
          active.writes[table] = (active.writes[table] ?? 0) + 1;
        }
        if (op === "1.0/get") add(decode(out));
        else if (op === "1.0/queryStreamNext") add(decode(out)?.value);
        else if (op === "1.0/queryPage") {
          active.ranges++;
          for (const d of decode(out)?.page ?? []) add(d);
        }
        return out;
      };
    },
    get jsSyscall() {
      return real.jsSyscall;
    },
  } as Syscalls;
}

/** fn の間に読まれたドキュメントを数える（直列に 1 本ずつ使う） */
export async function profileReads<T>(fn: () => Promise<T>): Promise<{ result: T } & ReadProfile> {
  install();
  active = { docs: 0, bytes: 0, ranges: 0, byTable: {}, writes: {} };
  try {
    const result = await fn();
    return { result, ...active };
  } finally {
    active = null;
  }
}
