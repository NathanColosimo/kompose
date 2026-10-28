"""Dump Python features for dataset rows (UTF-16 offsets) for the TS parity test."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from features import Featurizer  # noqa: E402

# run-snapshot.sh runs a copy of this file elsewhere; TRAINING_ROOT points home.
ROOT = Path(os.environ.get("TRAINING_ROOT") or Path(__file__).resolve().parent.parent)
featurizer = Featurizer(str(ROOT / "data/embeddings/electra-small/tokenizer.json"))


def utf16(text, index):
    return sum(2 if ord(c) > 0xFFFF else 1 for c in text[:index])


cases = []
for path in sys.argv[1:]:
    for line in open(path):
        if not line.strip():
            continue
        row = json.loads(line)
        e = featurizer.encode(row["text"], row["tagList"])
        cases.append({
            "text": row["text"], "tagList": row["tagList"],
            "ids": e.ids, "specials": e.specials, "shapes": e.shapes, "segments": e.segments,
            "spaced": e.spaced, "overlap": e.overlap, "tagPositions": e.tag_positions,
            "offsets": [[-1, -1] if s < 0 else [utf16(row["text"], s), utf16(row["text"], t)] for s, t in e.offsets],
            "links": [[utf16(row["text"], s), utf16(row["text"], t)] for s, t in e.links],
        })
json.dump(cases, open(ROOT / "data/features-parity.json", "w"))
print(len(cases), "cases")
