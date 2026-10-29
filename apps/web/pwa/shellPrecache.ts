type ShellChunk = {
  type: string;
  isEntry?: boolean;
  imports?: readonly string[];
  viteMetadata?: { importedCss?: ReadonlySet<string> };
};

const href = (file: string) => (file.startsWith("/") ? file : `/${file}`);

/**
 * install で必ず取る外枠。エントリと、それを実行する静的 import、その CSS。
 * 画面ごとの dynamic import は含めない（outsideShell の preload として、取れなくても install を止めずに取る）。
 */
export function shellPrecache(
  bundle: Record<string, ShellChunk>,
  fromPublic: readonly string[],
): string[] {
  const seen = new Set<string>();
  const visit = (fileName: string) => {
    if (seen.has(fileName)) return;
    const item = bundle[fileName];
    if (!item || item.type !== "chunk") return;
    seen.add(fileName);
    for (const css of item.viteMetadata?.importedCss ?? []) seen.add(css);
    for (const child of item.imports ?? []) visit(child);
  };
  for (const [fileName, item] of Object.entries(bundle)) {
    if (item.type === "chunk" && item.isEntry) visit(fileName);
  }
  const built = [...seen].map(href).sort();
  return ["/index.html", ...built, ...fromPublic];
}

/**
 * 外枠には入れないが、この版が使うハッシュ付きのファイル。sw.template.js が新しい版の install で、
 * 前の版のキャッシュにあるものは通信せずに写す。
 * - preload（JS・CSS。画面ごとのチャンク・PDF.js の本体）: 写せなければ取りに行く。デプロイのあと、古い外枠が読むチャンクは
 *   配信側から消えている（Pages は index.html を返す）ので、開いたことのない画面の分も先に持っておく。
 *   アイコンのフォントも同じ（アイコンを足すたびに名前が変わり、前の版からは写せない。無いとアイコンが文字で出る）
 * - carry（日本語フォントの分割ファイル・PDF.js のワーカーなど）: 写すだけで取りに行かない（使うときに取る）
 * 一覧はこの版のものだけなので、前の版だけが使っていたファイルは写されず、版ごとのキャッシュと一緒に消える（溜まらない）
 */
export function outsideShell(
  bundle: Record<string, ShellChunk>,
  precache: readonly string[],
): { preload: string[]; carry: string[] } {
  const shell = new Set(precache);
  const files = Object.keys(bundle)
    .filter((f) => f.startsWith("assets/"))
    .map(href)
    .filter((p) => !shell.has(p))
    .sort();
  const needed = (p: string) => /\.(js|css)$|\/material-symbols-subset-[^/]+\.woff2$/.test(p);
  return { preload: files.filter(needed), carry: files.filter((p) => !needed(p)) };
}
