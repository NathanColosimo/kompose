# Magic box annotation spec

The magic box turns one line (or a short stream) of free text into a task.
A small model labels every word of the input; deterministic code turns the
labelled spans into fields. This file is the single source of truth for the
labels. Generators, verifiers and the test set all follow it.

## Output fields

| Field | Source |
| --- | --- |
| title | `T` spans, joined with a space, first letter capitalized |
| description | `D` spans, joined with a space, first letter capitalized |
| startDate, startTime | `S` span, resolved by gpu-time |
| dueDate | `U` span, resolved by gpu-time |
| recurrence | `R` span (+ `S`/`U` anchor), resolved by gpu-time |
| durationMinutes | `M` span, resolved by the duration parser |
| links | `L` spans |
| tags | chosen from the user's tag list (see Tags) |

Words that are not inside any span are dropped (connectors such as "by",
"for", "at", "and", punctuation). Every word that describes the task itself
must be inside T or D; only connectors, cue words, vague times and noise stay
unlabelled.

## Markup

Examples are written inline: `[X:text]` where `X` is one label letter.

```
[F:remind me to] [T:call mom about the trip] [S:tmrw at 4] for [M:30 min], [D:ask her to bring the passports]
```

- Removing the markup must give back the exact input text, character for
  character. `[F:remind me to] [T:call mom]` is the text `remind me to call mom`.
- Spans never nest or overlap, and never include leading/trailing spaces.
- Punctuation at the edge of a span stays outside it ("[F:todo]:", "[T:call
  mom]."), except inside links and the "#"/"@" of a tag mention ("[G:#work]").
- The input text never contains `[` or `]`.
- A field may have several spans when other words interrupt it:
  `[T:call] [S:tomorrow] [T:the landlord]` gives the title "call the landlord".

## Labels

### T: title
The core action and its object, as the user wrote it: "call mom about the
trip", "fix login bug on safari", "Read Tomorrow, and Tomorrow, and Tomorrow".
Keep people, places and objects. Leave out everything another label covers.
Words that look like dates but are part of the thing stay in the title:
"watch [T:Friday Night Lights]", "[T:march madness bracket]", "[T:read 1984]",
"[T:buy a 30 min parking pass]", "[T:email May about the lease]".

### D: description
Extra detail that is not the core action: notes, reminders about the task,
context. Background sentences ("The truck's low on propane.", "I keep
thinking the cooldown is too long.") and secondary actions after the main
one ("…, then check the flour chute too", "and bring the brake cable") are D.
A short compound object stays in the title ("pick up propane and bowls"). Usually after the main ask and a comma, dash, colon, "and also",
"note", or a new sentence: "[T:call the bank], [D:ask about the late fee and
the card limit]". Not every trailing clause is a description: "call the bank
about the late fee" is all title. When in doubt, keep it in the title.

### S: start / when
When the user will do it or when it happens, not recurring: "tomorrow",
"next tue 3pm", "tonight", "this weekend", "in 2 hours", "the 15th", "sat
morning", "at noon", "3pm-5pm thursday".
- Exclude a leading "on" or "at": "on [S:friday]", "at [S:4]", "at [S:noon]".
  Keep words inside the expression: "[S:friday at 4]", "[S:tomorrow morning]".
- Exclude cue words like "starting", "from", "beginning": "starting [S:next monday]".
- A timezone after a time belongs to the span: "[S:3pm ET]".
- When the user corrects themselves ("not tomorrow, friday", "actually make
  it 3pm"), only the final value is labelled; the replaced one is unlabelled.
- A date that only gives context and is not when the task happens stays in
  the title or description: "[T:reply to yesterday's email]", "[T:review
  last week's notes]".
- A vague time with no date or clock time ("later", "soon", "asap", "after
  lunch", "sometime") is not labelled S; leave it unlabelled.

### U: due
A deadline. The cue word ("by", "due", "due on", "before", "no later than",
"deadline", "until" when it means a deadline) is NOT part of the span:
"by [U:friday]", "due [U:nov 1]", "before [U:end of month]", "deadline
[U:the 15th]". If the same expression is both when and deadline, it is U.
A task can have both: "[T:draft report] [S:monday], due [U:friday]".

### R: recurrence
How the task repeats, including the days and the clock time that belong to
the repetition (the time goes inside R, never in a separate S):
"[R:every weekday at 9:30]", "[R:every other tuesday]", "[R:monthly on the
1st]", "[R:every day for 2 weeks]", "[R:weekly]", "[R:each morning at 7]",
"[R:every monday and wednesday]", "[R:the 1st of every month]".
- A start for the series is a separate S: "[R:every monday] starting [S:next week]".
- A deadline inside each cycle is a separate U: "[T:pay rent] [R:every month] by [U:the 1st]".
- One-off plurals that do not repeat stay S or unlabelled.

### M: duration
How long the task takes: "[M:30 min]", "[M:an hour and a half]", "[M:2h]",
"[M:half an hour]", "[M:90 mins]", "[M:1h30]", "[M:a couple hours]",
"[M:15m]". Exclude "for", "takes", "about", "around", "~", "approx":
"for [M:30 min]", "takes about [M:an hour]". A time range is S, not M
("[S:3pm-5pm]").

### L: link
A URL or bare domain/path: "[L:https://github.com/x/y/pull/12]",
"[L:youtube.com/watch?v=abc]", "[L:notion.so/roadmap]". Not plain words like
"github" or "the doc".

### G: tag mention
Words whose only job is to name a tag or category, so they leave the title:
"[G:#work]", "[G:work]: [T:send invoice]", "[T:book flights] ([G:travel])",
"[T:fix the sink] - [G:home]", "[T:renew passport] [G:for the travel list]".
If the word is part of the action it stays T: "[T:email boss about work trip]".

### F: filler
Words that carry no task content: "remind me to", "i need to", "i have to",
"gotta", "don't forget to", "todo:", "add a task to", "ok so", "um", "like",
"also", "please", "can you", "make sure to", "i should".

## Tags

Each example comes with the user's tag list, for example
`["Work", "Health", "💼 Clients", "deep work", "kompose", "Errands"]`.
Tags are chosen only from that list, with the list's exact spelling.

- Explicit: a G mention or a direct name match picks that tag ("#work" →
  "Work", "(clients)" → "💼 Clients").
- Implied: only when a careful human would be confident: "gym" → "Health",
  "PR review" → "Work" (if the list has no more specific tag), "groceries" →
  "Errands". Zero or one tag is typical; more only when clearly separate.
- Never pick a tag just because a word is loosely related. When unsure, no tag.
- Every hashtag ("#work", "#家庭", "#Q4") and @context ("@home", "@calls") is G. It picks the matching tag
  if the list has one, otherwise nothing.
- A context prefix ("re: launch", "for the Hartwell project:", "Fwd:",
  "Slack:") is G when it names one of the user's tags, otherwise unlabelled.
- The text must justify the tag. A tag never applies just because it is in
  the list.

## Resolution notes

- Bare hours 1–7 without am/pm mean pm ("at 4" → 16:00); 8–11 mean am.
- Day parts: morning 9:00, afternoon 13:00, evening 18:00, night 20:00.
- Durations become whole minutes ("a couple hours" → 120).
- Recurrence must fit the task schema: daily, weekly (by weekdays), monthly
  (one day of month), yearly, each with an interval and optional count or
  end date. Anything else (e.g. "first monday of every month") keeps the
  first date and drops the recurrence.
