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
