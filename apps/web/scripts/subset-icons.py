#!/usr/bin/env python3
"""
Material Symbols（可変フォント・全アイコン約 4MB）を、このアプリで使うアイコンだけに絞る。

- アイコン名は src/ と M3E（@m3e/web）のソースにある文字列リテラルのうち、フォントのリガチャ名と一致するもの
  （条件式や配列で選ぶアイコンも拾えるよう、使い方ではなく文字列で集める。多めに入っても害は無い）
- 軸は styles.css の使い方に合わせて FILL 0–1・wght 400–600 を残し、GRAD 0・opsz 24 に固定する
- 出力: src/assets/material-symbols-subset.woff2 と src/assets/material-symbols-subset.json（入れたアイコン名）

アイコンを増やしたら実行し直す（`pnpm --filter @mf100/web icons`。要 Python 3 と `pip install fonttools brotli`）。
入れ忘れは src/lib/iconSubset.test.ts が検出する。
"""

import json
import re
import sys
from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEB = Path(__file__).resolve().parent.parent
FONT = WEB / "node_modules/@fontsource-variable/material-symbols-outlined/files/material-symbols-outlined-latin-full-normal.woff2"
OUT_FONT = WEB / "src/assets/material-symbols-subset.woff2"
OUT_NAMES = WEB / "src/assets/material-symbols-subset.json"
LITERAL = re.compile(r"""["'`]([a-z0-9][a-z0-9_]{1,40})["'`]""")


def ligatures(font: TTFont) -> dict[str, str]:
    """リガチャ名（例: "home"）→ グリフ名"""
    rev = {g: chr(c) for c, g in font.getBestCmap().items()}
    out: dict[str, str] = {}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if st.LookupType == 7:
                st = st.ExtSubTable
            if getattr(st, "LookupType", None) != 4:
                continue
            for first, ligs in st.ligatures.items():
                for lig in ligs:
                    comps = [first, *lig.Component]
                    if all(c in rev for c in comps):
                        out["".join(rev[c] for c in comps)] = lig.LigGlyph
    return out


def used_literals() -> set[str]:
    found: set[str] = set()
    roots = [WEB / "src", *sorted((WEB / "node_modules/@m3e/web/dist").glob("*.js"))]
    for root in roots:
        files = [root] if root.is_file() else [*root.rglob("*.ts"), *root.rglob("*.tsx")]
        for f in files:
            if f.name.endswith(".min.js") or ".test." in f.name:
                continue
            found.update(LITERAL.findall(f.read_text(encoding="utf-8", errors="ignore")))
    return found


def main() -> int:
    full = TTFont(str(FONT))
    ligs = ligatures(full)
    names = sorted(n for n in used_literals() if n in ligs)
    print(f"icons: {len(names)} / {len(ligs)}", file=sys.stderr)

    font = instancer.instantiateVariableFont(
        full, {"GRAD": 0, "opsz": 24, "wght": (400, 600)}, updateFontNames=False
    )
    buf = BytesIO()
    font.save(buf)
    buf.seek(0)
    font = TTFont(buf)

    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.layout_closure = False  # 残したグリフに至るリガチャだけを残す（文字の組合せから全アイコンを拾わない）
    opts.flavor = "woff2"
    opts.notdef_outline = True
    opts.name_IDs = ["*"]
    sub = subset.Subsetter(opts)
    chars = sorted({c for n in names for c in n} | set(" "))
    sub.populate(glyphs=[ligs[n] for n in names], unicodes=[ord(c) for c in chars])
    sub.subset(font)
    OUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(OUT_FONT))
    OUT_NAMES.write_text(json.dumps(names, indent=0) + "\n", encoding="utf-8")
    print(f"wrote {OUT_FONT.relative_to(WEB)} ({OUT_FONT.stat().st_size // 1024} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
