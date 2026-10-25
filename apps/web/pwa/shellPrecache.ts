type ShellChunk = {
  type: string;
  isEntry?: boolean;
  imports?: readonly string[];
  viteMetadata?: { importedCss?: ReadonlySet<string> };
};

const href = (file: string) => (file.startsWith("/") ? file : `/${file}`);

/**
 * install で先に取る外枠。エントリと、それを実行する静的 import、その CSS。
 * 画面ごとの dynamic import は含めない（sw.template.js が /assets/ を実行時にキャッシュする）。
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
 * 外枠には入れないが、この版が使うハッシュ付きのファイル（画面ごとのチャンク・PDF.js の本体とワーカー・フォントの分割ファイル）。
 * sw.template.js が新しい版の install で、前の版のキャッシュにあるものを通信せずに写す（取りに行かない。無ければ使うときに取る）。
 * 以前は版が替わるたびに前の版ごと消していたので、更新のたびに PDF.js（圧縮後およそ 540KB）や使ったフォントの分割ファイルを取り直していた。
 * 一覧はこの版のものだけなので、前の版だけが使っていたファイルは写されず、版ごとのキャッシュと一緒に消える（溜まらない）
 */
export function carriedAssets(
  bundle: Record<string, ShellChunk>,
  precache: readonly string[],
): string[] {
  const shell = new Set(precache);
  return Object.keys(bundle)
    .filter((f) => f.startsWith("assets/"))
    .map(href)
    .filter((p) => !shell.has(p))
    .sort();
}
