"""Training-time augmentations that keep labels exact.

Spans use code-point offsets (after utf16_to_codepoints).
"""

from __future__ import annotations

import random
import re

# Labels whose text can be swapped between examples without changing tags.
SWAPPABLE = ("S", "U", "R", "M", "F")


REPEAT_WORDS = re.compile(
    r"\b(every|each|daily|weekly|monthly|yearly|annually|nightly|biweekly|fortnightly|quarterly|"
    r"weekdays|weekends|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays|mwf|m-f|once|twice)\b",
    re.IGNORECASE,
)


def build_pools(rows: list[dict], extra: dict[str, list[str]]) -> dict[str, list[str]]:
    """Phrases per label from the data, plus grammar phrases (gen/phrases.ts)
    weighted to about a third of each pool."""
    pools: dict[str, set[str]] = {label: set() for label in SWAPPABLE}
    for row in rows:
        labels = [span["label"] for span in row["spans"]]
        for span in row["spans"]:
            # A label split over several spans gives fragments ("at noon" of a repeat).
            if span["label"] in pools and labels.count(span["label"]) == 1:
                phrase = row["text"][span["start"]:span["end"]]
                if span["label"] != "R" or REPEAT_WORDS.search(phrase):
                    pools[span["label"]].add(phrase)
    out = {label: sorted(values) for label, values in pools.items()}
    for label, phrases in extra.items():
        share = max(1, len(out[label]) // 2)
        out[label] += random.Random(label).choices(phrases, k=min(share, len(phrases) * 3))
    return out


def replace_span(text: str, spans: list[dict], index: int, new: str) -> tuple[str, list[dict]]:
    """Replace the text of spans[index] with `new`, shifting later spans."""
    target = spans[index]
    delta = len(new) - (target["end"] - target["start"])
    text = text[: target["start"]] + new + text[target["end"]:]
    out = []
    for i, span in enumerate(spans):
        if i == index:
            out.append({**span, "end": span["start"] + len(new)})
        elif span["start"] >= target["end"]:
            out.append({**span, "start": span["start"] + delta, "end": span["end"] + delta})
        else:
            out.append(span)
    return text, out


def swap_phrases(text: str, spans: list[dict], pools: dict[str, list[str]], rate=0.3):
    order = sorted(range(len(spans)), key=lambda i: spans[i]["start"], reverse=True)
    for index in order:
        label = spans[index]["label"]
        if label in pools and pools[label] and random.random() < rate:
            text, spans = replace_span(text, spans, index, random.choice(pools[label]))
    return text, spans


KEYBOARD = "abcdefghijklmnopqrstuvwxyz"


# Labels a typo can land in: dates get misspelled too ("thanksgivng").
TYPO_LABELS = ("T", "D", "S", "U", "R")


def typo(text: str, spans: list[dict], rate=0.12, only: int | None = None):
    """One realistic typo in a word of 5+ letters of a title, description or
    date (or of spans[only]). Returns the new text and spans and the label
    typed wrong (or None)."""
    if random.random() >= rate:
        return text, spans, None
    candidates = []
    for i, span in enumerate(spans):
        if span["label"] not in TYPO_LABELS or only not in (None, i):
            continue
        start = span["start"]
        for word in text[span["start"]:span["end"]].split(" "):
            if len(word) >= 5 and word.isalpha():
                candidates.append((i, start, word))
            start += len(word) + 1
    if not candidates:
        return text, spans, None
    index, start, word = random.choice(candidates)
    position = random.randrange(1, len(word) - 1)
    kind = random.choice(["drop", "swap", "double", "replace"])
    if kind == "drop":
        new = word[:position] + word[position + 1:]
    elif kind == "swap":
        new = word[:position] + word[position + 1] + word[position] + word[position + 2:]
    elif kind == "double":
        new = word[:position] + word[position] + word[position:]
    else:
        new = word[:position] + random.choice(KEYBOARD) + word[position + 1:]
    span = spans[index]
    inner_start = start - span["start"]
    span_text = text[span["start"]:span["end"]]
    new_span_text = span_text[:inner_start] + new + span_text[inner_start + len(word):]
    return *replace_span(text, spans, index, new_span_text), span["label"]


HOLIDAY = re.compile(
    r"christmas|xmas|thanksgiving|halloween|easter|valentine|memorial|labou?r day|independence|juneteenth|"
    r"mother|father|new year|patrick|paddy|black friday|cyber monday|\bnye\b|\bmlk\b|veteran|president|"
    r"groundhog|boxing day|columbus|canada day|cinco de|tax day|earth day|good friday|of july",
    re.IGNORECASE,
)


def holiday_pools(pools: dict[str, list[str]]) -> dict[str, list[str]]:
    """The start and due phrases that name a holiday."""
    return {label: [p for p in pools.get(label, []) if HOLIDAY.search(p)] for label in ("S", "U")}


def swap_holiday(text: str, spans: list[dict], holidays: dict[str, list[str]]):
    """A start or due date replaced by a holiday phrase, misspelled half the
    time (the generated data has few holidays). None if there's no date."""
    dates = [i for i, span in enumerate(spans) if holidays.get(span["label"])]
    if not dates:
        return None
    index = random.choice(dates)
    text, spans = replace_span(text, spans, index, random.choice(holidays[spans[index]["label"]]))
    text, spans, _ = typo(text, spans, rate=0.5, only=index)
    return text, spans


# Holiday words that describe a task rather than date it ("wrap christmas gifts").
TITLE_HOLIDAYS = [
    "christmas", "Christmas", "xmas", "thanksgiving", "Thanksgiving", "halloween", "Halloween",
    "easter", "Easter", "valentine's", "valentines", "new year's", "new years", "4th of july",
    "fourth of july", "memorial day", "labor day", "mother's day", "mothers day", "father's day",
    "st patrick's day", "black friday", "holiday", "hanukkah", "passover", "diwali",
]


def holiday_in_title(text: str, spans: list[dict]):
    """A holiday word before the last word of a title of 2+ words, still
    title: holidays inside a title aren't its date. None if no title fits."""
    titles = [i for i, span in enumerate(spans) if span["label"] == "T" and " " in text[span["start"]:span["end"]].strip()]
    if not titles:
        return None
    index = random.choice(titles)
    span = spans[index]
    title = text[span["start"]:span["end"]]
    cut = title.rstrip().rfind(" ") + 1
    return replace_span(text, spans, index, f"{title[:cut]}{random.choice(TITLE_HOLIDAYS)} {title[cut:]}")


# Terse layouts people type into a quick-add box. `{X}` is a span of label X;
# everything else stays unlabelled. Composed from real titles and phrases so
# short inputs ("vacuum the car this weekend") are well covered.
LAYOUTS = [
    "{T} {S}", "{S} {T}", "{T} {S} {M}", "{T} {M} {S}", "{T} by {U}", "{T} due {U}",
    "{T} {R}", "{R} {T}", "{T} for {M}", "{T} {M}", "{T}, {M}, {S}", "{S}: {T}",
    "{T} {R} starting {S}", "{T} {S} for {M}", "{T} - {U}", "{T} ({M})", "{T} {U}",
    "{F} {T} {S}", "{F} {T} by {U}", "{F} {T} {R}", "{T} {S} by {U}", "{T} {R} for {M}",
    "{T} {S}, {M}", "{T} before {U}", "{S} {T} {M}", "{M} {T}", "{T}",
]


def compose(row: dict, pools: dict[str, list[str]]) -> tuple[str, list[dict]] | None:
    """A short input from this row's title plus phrases from the pools, or
    None when the row's tags may depend on more than its title."""
    if any(span["label"] in ("D", "G") for span in row["spans"]):
        return None
    titles = [row["text"][s["start"]:s["end"]] for s in row["spans"] if s["label"] == "T"]
    if len(titles) != 1:
        return None
    layout = random.choice(LAYOUTS)
    text, spans, rest = "", [], layout
    while rest:
        start = rest.find("{")
        if start < 0:
            text += rest
            break
        text += rest[:start]
        label = rest[start + 1]
        rest = rest[start + 3:]
        phrase = titles[0] if label == "T" else random.choice(pools.get(label) or [""])
        if not phrase:
            return None
        spans.append({"label": label, "start": len(text), "end": len(text) + len(phrase)})
        text += phrase
    return text, spans
