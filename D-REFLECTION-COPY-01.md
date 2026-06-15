# D-REFLECTION-COPY-01 — Weekly Reflection: Warm-Register Copy Spec

**Type:** Design / copy alignment doc (read-only — no build in this prompt)
**Surface:** Weekly Reflection ceremony (the celebratory weekly beat; replaces the prior end-of-game ceremony framing)
**Status:** Copy register decided. Pixels NOT yet briefed. This doc is the words-before-pixels gate.

-----

## 0. The one sentence

> What the user should feel as they close the weekly Reflection:
> **“My people and I built something this week.”**

Warm-reflective in substance, celebratory in feel. Every decision below resolves
in favor of *recognition* (this is mine, and it happened through people I know)
over *achievement* (here are my stats). When a cut would make a slide read like a
generic achievement screen, the cut is wrong — that’s meaning, not clutter.

**Governing tension:** warmth comes from *specificity*, momentum comes from
*abstraction*. We compress the **structure** (kill paragraphs, kill repeating
scaffolding, impose hierarchy) but keep the **meaning** (name the person, name the
domain, let one specific thing carry the slide). Compress structure, not meaning.

-----

## 1. Canonical vocabulary (do not invent parallel terms)

These are live. Copy threads through them; it does not coin synonyms.

|Concept                                                |Canonical term                               |Notes                                           |
|-------------------------------------------------------|---------------------------------------------|------------------------------------------------|
|Authored a question → domain opens                     |**declared** territory                       |screenshot 4 label: DECLARED                    |
|Friend answered your question correctly → domain proven|**demonstrated** territory                   |screenshot 4 label: DEMONSTRATED                |
|Tier ladder (depth)                                    |**Establishing → Familiar → Solid → Mastery**|circle-ring system                              |
|Wrong/expired answer                                   |a **discovery**, never a failure             |connection event; feeds reaction-rate north star|

Banned register (carried from feed copy rules): no competition language —
“beat,” “had your number,” “unstoppable,” “on a roll,” “called it.” Names lead.
Contractions everywhere. Warm-sincere, not clever-for-its-own-sake.

-----

## 2. Beat-by-beat: structural fix + final copy

Each entry: **the craft fix** (what was structurally wrong) → **final copy** →
**slot variables** the build needs to fill.

### Beat A — Leveled up (tier movement)

**Craft fix:** Works already. Don’t turn four equal rows into a wall — one headline,
a tight named list, no repeating circle/title/status triad.

**Copy:**

> **You leveled up.**
> {n} territories grew this week.
>
> {domain} — now {tier}
> {domain} — now {tier}
> {domain} — now {tier}
> {domain} — now {tier}

- “now {tier}” lowercase — a state you arrived at, not a DB transition.
- Keep the implied movement; do NOT flatten to bare status. The *growth* is the feeling.
- Slots: `n` (count), per-row `domain`, `tier` (Familiar | Solid | Mastery).

### Beat B — Somewhere new (friend-mediated discovery)

**Craft fix:** Kill the comma-list paragraph (”…picked up 6 questions in A, B, C, D,
and E”). It’s read, not felt. Keep the **friend attribution** — it’s the meaning, not
decoration. “You explored new territory” is generic; “your friends took you somewhere
new” is recognition.

**Copy:**

> **Your friends took you somewhere new.**
> {n} places this week — starting with {lead_domain}.
>
> {domain} {dots}
> {domain} {dots}
> +{remainder} more

- Headline carries the “through your friends” idea; paragraph dies.
- Body names ONE specific lead domain, not five.
- `dots` = question count per domain (•, ••) — quiet hierarchy, already in screenshots.
- Cap visible domains at 2–3; rest tuck behind “+{remainder} more” (tappable).
- Slots: `n`, `lead_domain`, per-row `domain` + `dots`, `remainder`.

### Beat C — Declared territory (you authored)

**Craft fix:** Same paragraph problem. Also: warm the verb. “Staked” is cold and
competition-adjacent. Authoring a question is *generous* — you planted something other
people will play. Thread the canonical word: **declared**.

**Copy:**

> **You declared new territory.**
> {n} places opened from questions you wrote.
>
> {domain} · {domain} · {domain} · {domain}
> +{remainder} more

- Uses canonical “declared”; pairs with screenshot 4’s DECLARED state label.
- Middle-dot inline list for the named few; overflow tucked.
- Slots: `n`, named `domain` list, `remainder`.

### Beat D — Demonstrated territory (a friend proved you)

**Craft fix:** This is the relational payoff and should read as warmth, not a stat.
Keep it. Thread canonical **demonstrated**.

**Copy:**

> **Your territory came to life.**
> A friend answered questions you wrote and proved you knew {domain} and {domain}.

- Directional accuracy rule (from feed copy): only claim what the data guarantees.
  A friend *answered* and *proved* — both true of the demonstrated transition. Safe.
- If >2 demonstrated domains: “…proved you knew {domain}, {domain}, and {n} more.”
- Slots: per-domain names, overflow `n`.

### Beat E — What you discovered (the missed questions) — EMOTIONAL PEAK

**Craft fix:** The prior critique wanted this *shrunk to three and pushed last as an
afterthought*. In the warm/weekly version this is the **peak**, not the dump. A wrong
answer in Joshing is a connection event — this is the most thesis-dense slide and the
one most tied to the reaction-rate north star. **Curate, don’t truncate.** Give it room
to breathe; make “view all” a real invitation, not a fallback.

**Copy:**

> **What you discovered this week.**
> {selected discovery cards — 2–3, with space}
>
> View all discoveries →

- This is the only beat that should feel *slower*. Reflection register, not sprint.
- Slots: selected discovery items; `view all` deep-link to Review.

-----

## 3. Two honest flags the build must resolve (DO NOT guess)

**FLAG 1 — Discovery selection rule is unproven.**
Beat E copy promises curation (“what you discovered,” top 2–3). Per the feed-variety
mechanism, selection by hash (djb2 % N) is *stable-but-random* — no semantic awareness.
If there is no signal for “most interesting missed question,” the copy is writing a
check the data can’t cash. Realistic proxies, in preference order:

1. “most friends also missed it” (most relational → best fits the thesis)
2. most recent
3. hash (random but stable)

**Decision needed before Beat E ships.** Until decided, Beat E copy is provisional.

**FLAG 2 — “Reflection” name vs “celebration” feel.**
Resolved as: celebratory in feel, reflective in substance. Watch that the build doesn’t
drift into a hype-reel that contradicts the name. Pacing note in Beat E (let it breathe)
is the main guardrail. Robyn is the right playtester to gut-check the register.

-----

## 4. What this doc does NOT decide (out of scope here)

- Pixel layout, animation, bubble sizing, card geometry.
- Number of cards / slide grouping — pacing is “more selective, better-paced,”
  explicitly NOT “cut it in half.” A warm weekly beat can take a beat or two more
  than a frictionless celebration would.
- Whether Beats C and D merge into one declared/demonstrated slide (a layout call).

Take the structural fixes whole. Treat the discovery-card length and friend
attribution as decided (keep both). Everything visual waits for a B-prompt.
