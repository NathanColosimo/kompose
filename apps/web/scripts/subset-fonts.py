#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools[woff]==4.68.0"]
# ///
"""Subset Sentient into the web fonts the site serves. Run by hand:

    uv run apps/web/scripts/subset-fonts.py

It reads the full fonts in apps/web/fonts/ and writes apps/web/src/fonts/: a
core and an extended file per style, and sentient.css with their @font-face
rules. Commit the output. documents/fonts.md says when to rerun it.
"""

from io import BytesIO
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEB = Path(__file__).resolve().parent.parent
SOURCES = {"upright": ("Sentient-Variable.woff2", "normal"), "italic": ("Sentient-VariableItalic.woff2", "italic")}
OUT = WEB / "src" / "fonts"

# Every font-weight the site's CSS sets is 400 or above (800/900 clamp to the
# font's 700 maximum), so the lighter masters are dropped.
WEIGHTS = (400, 700)
# The features browsers apply by default that the font has. Nothing in the
# site's CSS enables others (tabular-nums asks for tnum, which Sentient lacks).
FEATURES = ["ccmp", "kern", "liga", "locl", "mark"]
# ASCII and the punctuation most pages use (curly quotes, en and em dashes,
# ellipsis, and the bullet Chrome draws for every <ul> marker), plus Latin-1,
# Latin Extended-A and combining accents. Accented letters stay in the core
# because the browser shapes each file's characters as separate runs: kerning
# and mark positioning between a core letter and an extended one are lost,
# which moved text after "café" by up to 1 px.
CORE = (
    set(range(0x20, 0x7F))
    | set(range(0xA0, 0x180))
    | set(range(0x300, 0x370))
    | {0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026}
)


def copy_font(font: TTFont) -> TTFont:
    """The subsetter edits a font in place; give each part its own copy."""
    buffer = BytesIO()
    font.save(buffer)
    buffer.seek(0)
    # Keep head.modified from the source so reruns produce identical files.
    return TTFont(buffer, recalcTimestamp=False)


def unicode_range(codepoints: set[int]) -> str:
    ranges, start, prev = [], None, None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            ranges.append((start, prev))
            start = prev = cp
    ranges.append((start, prev))
    return ", ".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in ranges)


def write_subset(font: TTFont, codepoints: set[int], path: Path) -> None:
    options = subset.Options()
    options.layout_features = FEATURES
    options.hinting = False
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(path)


def check(path: Path, codepoints: set[int]) -> TTFont:
    """Font tools fail quietly; confirm each file holds what its CSS claims."""
    font = TTFont(path)
    cmap = set(font.getBestCmap())
    assert cmap == codepoints, f"{path.name}: cmap differs from the request by {sorted(cmap ^ codepoints)}"
    (axis,) = font["fvar"].axes
    assert (axis.axisTag, axis.minValue, axis.maxValue) == ("wght", *WEIGHTS), f"{path.name}: axis {axis.axisTag} {axis.minValue}-{axis.maxValue}"
    for tag in ("GSUB", "GPOS"):
        if tag in font:
            used = {record.FeatureTag for record in font[tag].table.FeatureList.FeatureRecord}
            assert used <= set(FEATURES), f"{path.name}: unexpected {tag} features {used - set(FEATURES)}"
    assert not {"fpgm", "prep", "cvt "} & set(font.keys()), f"{path.name}: still hinted"
    return font


def main() -> None:
    rules = []
    for style_name, (source, css_style) in SOURCES.items():
        source_path = WEB / "fonts" / source
        full = TTFont(source_path, recalcTimestamp=False)
        # Sentient maps U+000D, which never renders (HTML turns CR into LF);
        # leave control characters out so they can't trigger a download.
        covered = {cp for cp in full.getBestCmap() if cp >= 0x20}
        limited = instancer.instantiateVariableFont(full, {"wght": WEIGHTS})
        limited.recalcTimestamp = False
        parts = {"core": covered & CORE, "extended": covered - CORE}
        for part, codepoints in parts.items():
            path = OUT / f"sentient-{style_name}-{part}.woff2"
            write_subset(copy_font(limited), codepoints, path)
            font = check(path, codepoints)
            print(f"{path.name}: {path.stat().st_size:>6} bytes, {font['maxp'].numGlyphs} glyphs, {len(codepoints)} characters")
            rules.append(
                "@font-face {\n"
                '  font-family: "Sentient";\n'
                f'  src: url("./{path.name}") format("woff2");\n'
                f"  font-weight: {WEIGHTS[0]} {WEIGHTS[1]};\n"
                "  font-display: swap;\n"
                f"  font-style: {css_style};\n"
                # Biome's CSS format, so the committed file passes `biome ci`.
                f"  unicode-range:\n    {unicode_range(codepoints)};\n"
                "}\n"
            )
        print(f"  from {source}: {source_path.stat().st_size} bytes")
    header = "/* Generated by apps/web/scripts/subset-fonts.py. Do not edit; rerun the script. */\n\n"
    (OUT / "sentient.css").write_text(header + "\n".join(rules))


if __name__ == "__main__":
    main()
