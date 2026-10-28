"""Turns (text, tag list) into model inputs, and gold spans into targets.

Mirrored in TypeScript by src/model/features.ts; keep the two in lockstep
(model/dump_features.py feeds src/model/features.parity.test.ts).
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field

from tokenizers import Tokenizer

# Span labels the model predicts. Links come from LINK_PATTERN instead.
LABELS = ["T", "D", "S", "U", "R", "M", "G", "F"]
# BIO tags: 0 = O, then B-x, I-x for each label.
TAG_NAMES = ["O"] + [f"{p}-{l}" for l in LABELS for p in ("B", "I")]
IGNORE = -100

# Special tokens live in their own small embedding table.
SPECIALS = ["[PAD]", "[CLS]", "[SEP]", "[URL]", "[TAG]"]
PAD, CLS, SEP, URL, TAG = range(len(SPECIALS))

# Word shapes, since the tokenizer lowercases everything.
SHAPES = ["special", "lower", "title", "upper", "digit", "mixed", "punct", "other"]

TLDS = (
    "com|org|net|io|dev|so|co|app|ai|me|ly|gg|tv|edu|gov|us|uk|ca|de|fr|jp|au|"
    "xyz|info|biz|link|page|site|tech|example|cloud|email|fm|to|sh|is|it|nz|in"
)
# ASCII semantics and an explicit character class, so JavaScript matches exactly.
URL_CHAR = r"[^ \t\n\r\f\v<>\"]"
LINK_PATTERN = re.compile(
    rf"(?:https?://|www\.){URL_CHAR}+"
    rf"|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:{TLDS})\b(?:/{URL_CHAR}*)?",
    re.IGNORECASE | re.ASCII,
)
TRAILING_LINK_PUNCT = re.compile(r"[.,;:!?)\]'\"]+$")
# JavaScript's \s.
WHITESPACE = set("\t\n\v\f\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff") | {chr(c) for c in range(0x2000, 0x200B)}

MAX_TEXT_TOKENS = 128
MAX_TOKENS = 256


def find_links(text: str) -> list[tuple[int, int]]:
    """Character ranges of URLs and bare domains, without trailing punctuation."""
    links = []
    for match in LINK_PATTERN.finditer(text):
        start, end = match.span()
        trailing = TRAILING_LINK_PUNCT.search(text[start:end])
        if trailing:
            end -= len(trailing.group(0))
        # An e-mail address is not a link.
        if start > 0 and text[start - 1] == "@":
            continue
        links.append((start, end))
    return links


def category(char: str) -> str:
    return unicodedata.category(char)


def shape(word: str) -> int:
    if not word:
        return SHAPES.index("other")
    if any(category(c) == "Nd" for c in word):
        return SHAPES.index("digit" if all(category(c) == "Nd" for c in word) else "mixed")
    letters = [c for c in word if category(c).startswith("L")]
    if not letters:
        if all(category(c)[0] in "PS" for c in word):
            return SHAPES.index("punct")
        return SHAPES.index("other")
    if all(category(c) == "Lu" for c in letters):
        return SHAPES.index("upper" if len(letters) > 1 else "title")
    if category(letters[0]) == "Lu":
        return SHAPES.index("title")
    return SHAPES.index("lower")


def words_of(text: str) -> set[str]:
    """Lowercased words of 2+ characters (letters, numbers, underscore)."""
    words, current = set(), []
    for char in text + " ":
        if char == "_" or category(char)[0] in "LN":
            current.append(char)
        else:
            if len(current) > 1:
                words.add("".join(current).lower())
            current = []
    return words


def spaced_before(source: str, start: int) -> int:
    return 1 if start > 0 and source[start - 1] in WHITESPACE else 0


@dataclass
class Encoded:
    ids: list[int] = field(default_factory=list)  # vocab id, or -1 for specials
    specials: list[int] = field(default_factory=list)  # special id, or PAD (0) for vocab tokens
    shapes: list[int] = field(default_factory=list)
    segments: list[int] = field(default_factory=list)  # 0 text, 1 tags
    spaced: list[int] = field(default_factory=list)  # whitespace before the token
    overlap: list[int] = field(default_factory=list)  # word also appears on the other side
    offsets: list[tuple[int, int]] = field(default_factory=list)  # text char range; (-1,-1) elsewhere
    tag_positions: list[int] = field(default_factory=list)  # index of each [TAG] marker
    links: list[tuple[int, int]] = field(default_factory=list)


class Featurizer:
    def __init__(self, tokenizer_path: str):
        self.tokenizer = Tokenizer.from_file(tokenizer_path)

    def _pieces(self, text: str, base: int) -> list[tuple[int, int, int]]:
        """(vocab id, start, end) for a plain segment, offsets shifted by base."""
        encoding = self.tokenizer.encode(text, add_special_tokens=False)
        return [(i, s + base, e + base) for i, (s, e) in zip(encoding.ids, encoding.offsets)]

    def encode(self, text: str, tag_list: list[str]) -> Encoded:
        out = Encoded()
        links = find_links(text)
        out.links = links
        tag_words = words_of(" ".join(tag_list))
        text_words = words_of(LINK_PATTERN.sub(" ", text))

        def add(vocab_id: int, special: int, start: int, end: int, segment: int, source: str):
            word = source[start:end] if start >= 0 else ""
            out.ids.append(vocab_id)
            out.specials.append(special)
            out.shapes.append(SHAPES.index("special") if special else shape(word))
            out.segments.append(segment)
            out.spaced.append(spaced_before(source, start))
            other = tag_words if segment == 0 else text_words
            out.overlap.append(1 if word.lower() in other else 0)
            out.offsets.append((start, end) if segment == 0 else (-1, -1))

        add(-1, CLS, -1, -1, 0, text)
        cursor = 0
        count = 0
        for link_start, link_end in [*links, (len(text), len(text))]:
            for vocab_id, start, end in self._pieces(text[cursor:link_start], cursor):
                if count < MAX_TEXT_TOKENS:
                    add(vocab_id, 0, start, end, 0, text)
                    count += 1
            if link_start < link_end and count < MAX_TEXT_TOKENS:
                add(-1, URL, link_start, link_end, 0, text)
                count += 1
            cursor = link_end
        add(-1, SEP, -1, -1, 0, text)
        for tag in tag_list:
            if len(out.ids) >= MAX_TOKENS - 1:
                break
            out.tag_positions.append(len(out.ids))
            add(-1, TAG, -1, -1, 1, tag)
            for vocab_id, start, end in self._pieces(tag, 0)[:8]:
                if len(out.ids) >= MAX_TOKENS:
                    break
                # Tag tokens keep their own offsets for shape/overlap only.
                out.ids.append(vocab_id)
                out.specials.append(0)
                word = tag[start:end]
                out.shapes.append(shape(word))
                out.segments.append(1)
                out.spaced.append(spaced_before(tag, start))
                out.overlap.append(1 if word.lower() in text_words else 0)
                out.offsets.append((-1, -1))
        return out


def bio_targets(encoded: Encoded, spans: list[dict]) -> list[int]:
    """BIO target per token: a text token takes the label of the span holding its start."""
    targets = []
    previous_span = None
    for (start, end), special in zip(encoded.offsets, encoded.specials):
        if start < 0 or special == URL:
            targets.append(IGNORE if start < 0 else 0)
            previous_span = None
            continue
        span = next((s for s in spans if s["start"] <= start < s["end"] and s["label"] in LABELS), None)
        if span is None:
            targets.append(0)
            previous_span = None
            continue
        prefix = "I" if previous_span is span else "B"
        targets.append(TAG_NAMES.index(f"{prefix}-{span['label']}"))
        previous_span = span
    return targets


def allowed_transition(previous: int, current: int) -> bool:
    """BIO: an I-X tag only continues a B-X or I-X."""
    name = TAG_NAMES[current]
    if not name.startswith("I-"):
        return True
    return previous > 0 and TAG_NAMES[previous][2:] == name[2:]


def viterbi(encoded: Encoded, scores: list[list[float]]) -> list[int]:
    """Best valid BIO sequence over the text tokens (specials, links and tag
    tokens are skipped and come back as O). `scores` are per-token log-probs."""
    positions = [i for i, (start, _) in enumerate(encoded.offsets) if start >= 0 and encoded.specials[i] != URL]
    result = [0] * len(scores)
    if not positions:
        return result
    count = len(TAG_NAMES)
    best = [scores[positions[0]][t] if allowed_transition(0, t) else -math.inf for t in range(count)]
    back: list[list[int]] = []
    for position in positions[1:]:
        row = scores[position]
        step, pointers = [], []
        for t in range(count):
            choice, value = 0, -math.inf
            for p in range(count):
                if best[p] > value and allowed_transition(p, t):
                    choice, value = p, best[p]
            step.append(value + row[t])
            pointers.append(choice)
        best = step
        back.append(pointers)
    tag = max(range(count), key=lambda t: best[t])
    for index in range(len(positions) - 1, -1, -1):
        result[positions[index]] = tag
        if index:
            tag = back[index - 1][tag]
    return result


def decode_spans(encoded: Encoded, predictions: list[int], text: str) -> list[dict]:
    """Merge BIO predictions back into character spans of `text`."""
    spans: list[dict] = []
    for index, ((start, end), tag) in enumerate(zip(encoded.offsets, predictions)):
        if start < 0 or encoded.specials[index] == URL or tag == 0:
            continue
        prefix, label = TAG_NAMES[tag].split("-")
        last = spans[-1] if spans else None
        continuing = (
            last is not None
            and last["label"] == label
            and last["last_token"] == index - 1
            and (prefix == "I" or (start == last["end"] and not encoded.spaced[index]))
        )
        if continuing:
            last["end"] = end
            last["last_token"] = index
        else:
            spans.append({"label": label, "start": start, "end": end, "last_token": index})
    for span in spans:
        span.pop("last_token")
        span["text"] = text[span["start"]:span["end"]]
    for start, end in encoded.links:
        spans.append({"label": "L", "start": start, "end": end, "text": text[start:end]})
    return sorted(spans, key=lambda s: s["start"])


def utf16_to_codepoints(text: str, spans: list[dict]) -> list[dict]:
    """Spans from the TypeScript side use UTF-16 offsets; Python uses code points."""
    mapping = {}
    unit = 0
    for index, char in enumerate(text):
        mapping[unit] = index
        unit += 2 if ord(char) > 0xFFFF else 1
    mapping[unit] = len(text)
    return [{**span, "start": mapping[span["start"]], "end": mapping[span["end"]]} for span in spans]
