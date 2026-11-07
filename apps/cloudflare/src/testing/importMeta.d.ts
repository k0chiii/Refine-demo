// Vite の import.meta.glob（テストだけが使う）。tsconfig が types: [] なので、要る分だけ手で添える
interface ImportMeta {
  glob(pattern: string, options?: { eager?: boolean }): Record<string, unknown>;
}
