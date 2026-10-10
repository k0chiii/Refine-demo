/// <reference types="react" />
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_API_URL: string;
  readonly DEV: boolean;
  readonly MODE: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module "*.css" {
  const css: string;
  export default css;
}
