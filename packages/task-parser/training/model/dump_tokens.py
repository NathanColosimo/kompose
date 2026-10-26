"""Dump Hugging Face tokenization of every dataset text (and tag) for the TS parity test.

Offsets are converted to UTF-16 to match JavaScript.
"""
import json
import sys
from pathlib import Path

from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parent.parent
tokenizer = Tokenizer.from_file(str(ROOT / "data/embeddings/potion-base-4M/tokenizer.json"))


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
    out.append({"text": text, "ids": encoding.ids, "offsets": [[utf16(text, s), utf16(text, e)] for s, e in encoding.offsets]})
json.dump({"vocab": [t for t, _ in sorted(tokenizer.get_vocab().items(), key=lambda kv: kv[1])], "cases": out}, open(ROOT / "data/tokenizer-parity.json", "w"))
print(len(out), "cases")
