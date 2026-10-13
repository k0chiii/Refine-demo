/// <reference types="react" />
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_API_URL: string;
  /** Vite の公開ベースパス。末尾は `/` */
  readonly BASE_URL: string;
  readonly DEV: boolean;
  readonly MODE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
  /** Vite の import.meta.glob（デモモードで Convex 関数モジュールを集めるために使用） */
  glob(pattern: string): Record<string, () => Promise<unknown>>;
}
declare module "*.css" {
  const css: string;
  export default css;
}
declare module "*?url" {
  const url: string;
  export default url;
}
