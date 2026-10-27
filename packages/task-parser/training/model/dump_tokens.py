"""Dump Hugging Face tokenization of every dataset text (and tag) for the TS parity tests.

uv run python model/dump_tokens.py [--embeddings potion-base-4M] <jsonl>...
Offsets are converted to UTF-16 to match JavaScript, after the same
leading-space trim features.py applies (byte-level BPE tokens carry it).
"""
import argparse
import json
import os
from pathlib import Path

from tokenizers import Tokenizer

# run-snapshot.sh runs a copy of this file elsewhere; TRAINING_ROOT points home.
ROOT = Path(os.environ.get("TRAINING_ROOT") or Path(__file__).resolve().parent.parent)
parser = argparse.ArgumentParser()
parser.add_argument("--embeddings", default="potion-base-4M")
parser.add_argument("data", nargs="+")
args = parser.parse_args()
spec = json.loads((ROOT / "data/embeddings" / args.embeddings / "tokenizer.json").read_text())
tokenizer = Tokenizer.from_file(str(ROOT / "data/embeddings" / args.embeddings / "tokenizer.json"))
WHITESPACE = set(" \t\n\r\f\v\u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff") | {chr(c) for c in range(0x2000, 0x200B)}


def utf16(text: str, index: int) -> int:
    return sum(2 if ord(c) > 0xFFFF else 1 for c in text[:index])


texts = set()
for path in args.data:
    for line in open(path):
        if line.strip():
            row = json.loads(line)
            texts.add(row["text"])
            texts.update(row.get("tagList", []))
extra = ["Café naïve résumé", "a‍b­c", "婚礼の準備 tomorrow", "x" * 120, "ﬁle Ａ１", "İstanbul ǅ", "tab\there\nnew"]
texts.update(extra)
out = []
for text in sorted(texts):
    encoding = tokenizer.encode(text, add_special_tokens=False)
    offsets = []
    for s, e in encoding.offsets:
        while s < e and text[s] in WHITESPACE:
            s += 1
        offsets.append([utf16(text, s), utf16(text, e)])
    out.append({"text": text, "ids": encoding.ids, "offsets": offsets})
merges = [m if isinstance(m, str) else " ".join(m) for m in spec["model"].get("merges", [])]
name = "tokenizer-parity.json" if args.embeddings == "potion-base-4M" else f"tokenizer-parity-{args.embeddings}.json"
added = [a["content"] for a in spec.get("added_tokens", [])]
json.dump({"vocab": [t for t, _ in sorted(tokenizer.get_vocab().items(), key=lambda kv: kv[1])], "merges": merges, "added": added, "cases": out}, open(ROOT / "data" / name, "w"))
print(len(out), "cases")
