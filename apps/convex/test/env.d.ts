/** Vitest（Vite）が提供する import.meta.glob の最小型。vite/client 型を引き込まずに済ませる。 */
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>;
}
