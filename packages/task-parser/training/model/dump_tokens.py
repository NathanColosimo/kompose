"""Dump Hugging Face tokenization of every dataset text (and tag) for the TS parity tests.

uv run python model/dump_tokens.py <jsonl>...
Offsets are converted to UTF-16 to match JavaScript.
"""
import json
import os
import sys
from pathlib import Path

from tokenizers import Tokenizer

# run-snapshot.sh runs a copy of this file elsewhere; TRAINING_ROOT points home.
ROOT = Path(os.environ.get("TRAINING_ROOT") or Path(__file__).resolve().parent.parent)
tokenizer = Tokenizer.from_file(str(ROOT / "data/embeddings/electra-small/tokenizer.json"))


def utf16(text: str, index: int) -> int:
    return sum(2 if ord(c) > 0xFFFF else 1 for c in text[:index])


texts = set()
for path in sys.argv[1:]:
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
    offsets = [[utf16(text, s), utf16(text, e)] for s, e in encoding.offsets]
    out.append({"text": text, "ids": encoding.ids, "offsets": offsets})
vocab = [t for t, _ in sorted(tokenizer.get_vocab().items(), key=lambda kv: kv[1])]
json.dump({"vocab": vocab, "cases": out}, open(ROOT / "data/tokenizer-parity.json", "w"))
print(len(out), "cases")
