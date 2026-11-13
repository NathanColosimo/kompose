# Fonts

The web app's text is Sentient, a variable font (`wght` axis) from ITF. The
full source files live in `apps/web/fonts/` and are not served. The site
serves subsets that `apps/web/scripts/subset-fonts.py` writes into
`apps/web/src/fonts/`, together with `sentient.css`, which `index.css`
imports. Generated files are committed; there is no font step in the build.

## What the subsets keep

- **Weights 400–700.** Nothing in the site's CSS asks for less than 400
  (800 and 900 clamp to the font's 700 maximum), so the lighter masters are
  dropped. The `@font-face` rules declare `400 700`.
- **Default OpenType features only:** `ccmp`, `kern`, `liga`, `locl`, `mark`.
  The CSS doesn't enable any others. `tabular-nums` asks for `tnum`, which
  Sentient doesn't have.
- **No hinting.** The source has none.
- **Every character the source maps,** except control characters. User text
  (task titles, event names) can contain any of them. Characters Sentient
  doesn't have, such as CJK, →, and ⌘, fall back to system fonts as before.

## Core and extended files

Each style (upright, italic) is split into two files, each behind a
`unicode-range` that lists only the characters it contains:

- **Core** holds ASCII, Latin-1, Latin Extended-A, combining accents, and the
  punctuation most pages use (curly quotes, dashes, ellipsis, and •, which
  Chrome draws for every `<ul>` marker). The root layout preloads the upright
  core.
- **Extended** holds the rest (€, ™, Greek, math symbols, ligature code
  points). The browser downloads it only for a page that has one of those
  characters.

Accented letters are in the core on purpose. The browser shapes each file's
characters as separate runs, so kerning and mark positioning between a core
letter and an extended one are lost. With ASCII alone in the core, text after
"café" moved by up to 1 px.

## When to rerun the script

Run `uv run apps/web/scripts/subset-fonts.py` and commit the output when:

- the source fonts change;
- the site starts using a weight below 400;
- CSS enables an OpenType feature not in the list above
  (`font-feature-settings`, `oldstyle-nums`, `diagonal-fractions`,
  `small-caps`, `ordinal`, …);
- a character in the extended file starts showing up on most pages.

The script checks each file it writes: its characters, axis range, features,
and that it has no hinting. Reruns produce identical files. Verify a change
with before/after pixel diffs of pages with accents, italics (including bold
inside italics), code, and CJK.
