#!/bin/sh
# Builds the Sentient files the site serves (src/fonts) from the full fonts
# (fonts/). It keeps every character and drops what no page uses: weights
# below 400, and the OpenType features that stay off unless CSS turns them on
# (old-style figures, stylistic sets, superscripts). Rerun it by hand if the
# site starts using one of those, and keep the weight range in src/index.css
# in step.
set -eu
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
for font in Sentient-Variable Sentient-VariableItalic; do
  uvx --from "fonttools[woff]==4.68.0" fonttools varLib.instancer \
    "fonts/$font.woff2" wght=400:700 --output "$tmp/$font.woff2"
  uvx --from "fonttools[woff]==4.68.0" pyftsubset "$tmp/$font.woff2" \
    --unicodes="*" --notdef-outline --flavor=woff2 \
    --output-file="src/fonts/$font.woff2"
done
rm -r "$tmp"
