> RECORD of a working session (thinking + verified read-only findings). Nothing here is ratified or a build instruction, except the one shipped flag flip explicitly noted under "What's shipped / in flight." Live code is the source of truth.

# JOSHING — Session Summary: Quality, Cost & the Human-Authored Direction

**What this is:** a single uploadable record of a long working session on Joshing's core question — *can we get good questions to players at a reasonable cost?* It captures the model we arrived at, what the data proved, what's still unproven, and the concrete next steps. Everything here is **thinking + verified findings**; the only shipped change is one flag flip (noted). Nothing else is built yet.

---

## THE BOTTOM LINE (if you read nothing else)

**Cost is not the problem. Quality is — and quality is a human problem, not a money problem.**

- Recurring spend is ~$3.64/day (~$110/mo), owned by daily Sonnet question-generation. Modest, and reducible without touching quality.
- The scary "$0.39/question" figure was a *paused* grounded-refill subsystem, not your live cost. Your live floor is cheap (~$0.004–0.02/question ungrounded, or free bank reuse).
- The cost that exists is **concentrated in deep, niche domains** (verified) — the exact domains worth hand-authoring. So improving quality there and cutting cost there are *the same act*.
- The good version of this game costs **your and Robyn's authoring time, not dollars.** The only genuinely unproven thing is whether hand-authored questions are good enough to carry the game — testable only by the Robyn test (below).

---

## THE MODEL WE ARRIVED AT

**Authority inversion.** The human authors questions and holds canon; the LLM is *staff* — it drafts candidates, verifies facts, rewords for fair grading, dedupes, and provides a cheap floor for un-mastered domains. It never decides what's *worth asking*. (The pivot's justification is QUALITY/anti-fabrication, not cost — the cheap machine floor *fabricates* on thin niche domains, e.g. inventing Spy School lore, which is the one failure the product can't tolerate.)

**Shallow/deep layering.** A good game needs a *mix*, not all hand-crafted gems. Shallow/accessible questions are fine for the machine (low bar by design). Deep/arcane questions are where humans earn their keep. The mix is the fun.

**Finite sets, no cap, no target.** A domain is as large as the good questions that exist. "Done" is *discovered* (nothing new clears the bar), never declared. Mastery is performance-based (play well across whatever exists), not completion-based.

**Quality × cost × availability = one constraint.** They're three faces of "how much good material is left in a domain." As a player mines deeper, all three degrade together. Cost is the cheapest-to-measure face → it's the exhaustion tripwire.

**Three doors at "you're out."** When a domain is exhausted: (1) wait for more, (2) expand up a domain tree (Book 3 → series → author → genre), (3) **add one yourself** — the player who just exhausted a domain is the best-qualified person to author more of it. Running out is the natural trigger to contribute.

**INVARIANT — a question is never served to its author.** Authoring spends a question *outward*; it never returns to its author. This makes authoring *contributor* standing (separate from play mastery) and closes a gameability hole structurally.

**Phase 1 = Josh + Robyn as generalist crafters/reviewers**, machine as staff, a two-panel admin surface. Community-scale machinery (domain-routed review, the full contributor system) deferred until the two-person core is proven.

---

## WHAT THE DATA PROVED (verified this session, read-only)

**Cost is modest and located.** ~$3.64/day; `generate-questions` (Sonnet) owns it ($1.96). batch-verify is bounded (≤~50 calls/day by construction, self-capping). Grading is cheap (Haiku, scope `grade`) — and the `*/answer` scopes are author-credit accounting, NOT LLM spend.

**The bill is concentrated in deep niche domains** (the key finding for the dashboard). 7-day fall-through proxy (each fall-through = one paid Sonnet generation):

| domain | tier | fall-throughs | miss-rate |
|--------|------|--------------:|----------:|
| Tears of the Kingdom | specialist | 15 | 94% |
| Spy School Books | moderate | 13 | 100% |
| Tennis Fundamentals | specialist | 13 | 100% |
| Sesame Street | specialist | 6 | 75% |
| + long tail: music theory, literary modernism | specialist | 2–4 each | ~100% |

→ Hand-authoring these converts **repeated paid misses into permanent free bank hits.** The admin dashboard is a **cost fix, not just a quality feature.**

**Two bonus findings:**

- **Domain-name fragmentation is manufacturing misses** — the same domain banked under multiple string keys (`T.S. Eliot`/`T. S. Eliot`, three Star Trek TNG spellings, Zelda variants) can't find its own questions → guaranteed re-generation. **A free cost win, pivot-independent — normalize the key. (Being fixed.)**
- ~14 fall-throughs have an empty/unparsed domain — minor proxy under-attribution.

**The hit-rate "regression" is cost-only, not player-facing.** A bank miss still serves a freshly-generated good question. Tiers stratify cleanly (specialist 13.8% / moderate 26.5% / accessible 37.5% hit) — healthy mix-shift, no break.

**Daily-play baseline: a small loyal core, flat.** 3–4 distinct players/day over 30 days (of ~18 onboarded), playing real depth. **But we are pre-beta** — questions aren't good yet, system isn't fully reliable — so this number is a *baseline, not a verdict*. The real signal to watch: does this line climb *as question quality improves*.

---

## CORRECTIONS THAT MATTER (don't let these get re-introduced)

- **Reactions are RETIRED, not broken.** They were removed (unused, a distraction from gameplay). The empty `QuestionReaction` table + `0006` schema drift is dead residue of a removed feature — **do NOT "fix" it to resurrect reactions.** Reaction-rate is NOT the north star.
- **The north star is a funnel:** (1) consistent daily play [primary], (2) inviting others [secondary], (3) creating questions [tertiary] — a ladder of deepening investment that matches the authoring model's newcomer→player→contributor→master progression. **Guardrail:** daily play is *measured*, never coercively optimized (no streaks/notification pressure — that's the engagement-machine the product rejects).
- **The pivot is justified by quality/anti-fabrication, not cost.** "Curation is 90× cheaper" was true only of the *grounded* path (paused, not running). Don't lead with the cost argument.

---

## WHAT'S SHIPPED / IN FLIGHT

- **SHIPPED:** `DAILY_TOPUP_CARRYFORWARD_ENABLED` flipped on (env only, fail-open) — stops regenerating a full Five for players who haven't consumed their existing one; carries unplayed questions forward, generates only the shortfall. Soak: watch generation-$ drop, the top-up log line fire, no rise in short-queue/failure logs.
- **IN FLIGHT:** domain-key-normalization fix (recovers double-billed questions from fragmented keys — free cost win).
- **NOT BUILT:** the two-panel admin dashboard, the authoring machinery, the contribution loop — all still design-only.

---

## THE ONE THING STILL UNPROVEN — THE ROBYN TEST

No query can answer it: **hand-author ~20 questions in a domain you love (machine drafts → you keep/kill/tweak), have Robyn play them, watch her real reactions on wrong answers.**

- Do hand-crafted questions visibly beat the machine-generated ones?
- Did the keep/kill/tweak loop feel *good*, or like a chore you'd quit in a month?
- **Yes on both → the pivot is validated by evidence, and the game can be good at reasonable cost. No → rethink before building.**

This is the whole answer to "can I make this good at reasonable cost." Cost is solved; quality-by-human-authoring is the bet; the Robyn test is the proof.

---

## NEXT STEPS (in order)

1. **Ship the domain-key-normalization fix** (free cost win, pivot-independent). ← in flight
2. **Do the Robyn evening** (the real test — the last genuine unknown).
3. **Build the two-panel admin / question surface** (cost-justified by the ③b finding). ← build prompt being drafted
4. Keep watching daily-play as question quality improves — the climb (or not) is the real experiment.

---

## KEY DISCIPLINE FROM THIS SESSION

Every validation query run this session corrected an assumption the design had reasoned to without checking (the cost justification, the regression severity, the reactions state, the cost location). **The lesson: pull real numbers before building.** The design is good and directionally right — but it earns the right to be built by contact with data and the Robyn test, not by the coherence of the reasoning alone.
