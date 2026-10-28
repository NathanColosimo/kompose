"""Dump Hugging Face tokenization and Python features of dataset rows for the
TypeScript parity tests (src/model/*.parity.test.ts), with UTF-16 offsets.

uv run python model/dump_parity.py data/clean/pilot.jsonl data/clean/pilot2.final.jsonl
→ data/tokenizer-parity.json (every text and tag), data/features-parity.json (every row)
"""

import json
import sys

from features import ROOT, Featurizer

featurizer = Featurizer()
tokenizer = featurizer.tokenizer


def utf16(text: str, index: int) -> int:
    return sum(2 if ord(c) > 0xFFFF else 1 for c in text[:index])


rows = [json.loads(line) for path in sys.argv[1:] for line in open(path) if line.strip()]

texts = {row["text"] for row in rows} | {tag for row in rows for tag in row["tagList"]}
texts |= {"Café naïve résumé", "a‍b­c", "婚礼の準備 tomorrow", "x" * 120, "ﬁle Ａ１", "İstanbul ǅ", "tab\there\nnew"}
tokens = []
for text in sorted(texts):
    encoding = tokenizer.encode(text, add_special_tokens=False)
    tokens.append({"text": text, "ids": encoding.ids, "offsets": [[utf16(text, s), utf16(text, e)] for s, e in encoding.offsets]})
ids = tokenizer.get_vocab()
json.dump({"vocab": sorted(ids, key=ids.get), "cases": tokens}, open(ROOT / "data/tokenizer-parity.json", "w"))
print(len(tokens), "tokenizer cases")

features = []
for row in rows:
    text = row["text"]
    e = featurizer.encode(text, row["tagList"])
    features.append({
        "text": text, "tagList": row["tagList"],
        "ids": e.ids, "specials": e.specials, "shapes": e.shapes, "segments": e.segments,
        "spaced": e.spaced, "overlap": e.overlap, "tagPositions": e.tag_positions,
        "offsets": [[-1, -1] if s < 0 else [utf16(text, s), utf16(text, t)] for s, t in e.offsets],
        "links": [[utf16(text, s), utf16(text, t)] for s, t in e.links],
    })
json.dump(features, open(ROOT / "data/features-parity.json", "w"))
print(len(features), "feature cases")
