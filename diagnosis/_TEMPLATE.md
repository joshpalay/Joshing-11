---
name: <slug-matching-filename>
status: planning
opened: YYYY-MM-DD
last-reviewed: YYYY-MM-DD
owner: Josh
related-pr: "#____"        # delete this line if there isn't one yet
---

# Diagnosis: <short title>

_Started YYYY-MM-DD · Owner: Josh · Working branch: `<branch>`<if applicable, PR #____>_

One or two sentences: is this a living document tracking open decisions, or
an experiment being measured before a decision gets made? Say so explicitly
— it changes how a reader should treat the "Recommendation" section below
(a running best-guess vs. a final call).

---

## 1. What triggered this

The concrete thing that started this — an incident, a question, a proposal.
Link real evidence (commits, PR numbers, row ids, error messages), not
paraphrases of it.

## 2. Open decisions

Numbered list, plain language, each one answerable with a name/number/yes-
or-no — not "figure out the right approach to X."

1. ...
2. ...

## 3. What we know so far

The evidence gathered, with numbers where possible. State assumptions
explicitly and flag which ones are load-bearing — if the assumption turns
out wrong, say what changes.

## 4. Plan

Phases or steps, each with a stated **exit criterion** — the specific
number or observation that would make the next phase (or the decision
itself) obvious. A phase without an exit criterion isn't a phase, it's a
task.

## 5. Recommendation (as of YYYY-MM-DD)

What you'd do if forced to decide today, and why — including what would
change your mind. Update this section's date whenever the recommendation
changes; don't leave a stale recommendation standing after new evidence.

---

## Updates

Append-only, most recent last, dated. Every entry that changes the picture
gets one — including a "checked, nothing changed" entry so a reader can
tell the difference between "not yet reviewed" and "reviewed, no news."

### YYYY-MM-DD
What happened, what it means, what's still outstanding.
