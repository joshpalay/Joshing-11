# PROBLEM CASES — a test suite for the question model

**Status: THINKING IN PROGRESS. Companion to `CONCEPT-master-authored-canonical-sets.md`.** Not a decision doc. Its job: turn the abstract model into 2–3 concrete, named player situations you can hold every design choice against. "Does this handle Ari at the bottom of Tears of the Kingdom?" is a sharper test than any principle.

---

## The spine (Josh's framing — the whole problem in one line)

> **Everything revolves around question quality, cost, and availability — and they are three faces of ONE constraint: how much good material is left in a domain for a player.**

They don't degrade independently. As a player mines a domain deeper, the remaining questions get *harder to find* (availability ↓), *more expensive to generate well* (cost ↑ — more search, more fabrication risk), and *worse* (quality ↓ — the arcane bottom is where generic-competent turns wrong-or-dull). All three go bad **together**, because all three measure the same underlying quantity running out. So there is one problem — *remaining good material* — with three symptoms. Every case below is a different *shape* of that one constraint hitting its limit.

**The honest response when the quantity runs low is always the same, and it's a feature, not an error:** say so. *"You're out of these — that's you having finished a real, finite thing, not a failure. We'll tell you if more come in. Meanwhile, where do you want to expand?"* Every alternative is a lie (fabricate → betrayal) or a betrayal (serve dreck → kills the fun) or a dead end (silently stop). Running out, said honestly, hands the player agency instead of a wall.

---

## Case 1 — ARI (deep exhaustion) — the lead case

**Who:** Ari, Josh's son, the "butt-kicker" persona. Plays Tennis and Tears of the Kingdom repeatedly, deep into each. Some questions are good, some aren't.

**The situation:** Ari mines a single domain toward the bottom. The good questions get used up; what's left is arcane, expensive to generate, and increasingly dreck-or-fabricated.

**What it stresses:** exhaustion-detection, the **cost tripwire**, and the graduation offer.

**How the current model handles it (end-to-end chain — this is the test of whether the model actually holds):**

1. **Detection.** Exhaustion is a *discovered state* (concept note §6b): the domain is "done" when nothing new clears the bar. For Ari, Tears of the Kingdom is exhausted not because a cap was set but because the good questions are genuinely used up.
2. **The cost tripwire fires.** Josh's "if the cost gets too high" is the *signal* — when generating one more good Tears of the Kingdom question costs more than it's worth (because availability is low and quality marginal), that economic line is exactly where the system stops pretending. **Cost is not a separate problem; it's the detector that the domain is exhausted.** This is the one place the three faces become operationally useful: cost is the measurable one, so it's the tripwire for the other two.
3. **The honest message.** *"You've played through the good Tears of the Kingdom questions."* Not an error — a completion.
4. **"We'll let you know when more come in."** The proven-by-play / contribution loop (§6): if a human (Josh, Robyn, eventually a ToTK master) authors more, Ari's domain reopens. Exhausted-for-now, refillable by craft — not dead.
5. **"Where do you want to expand?"** Graduation climbs the tree (§6a): Tears of the Kingdom → Zelda series → Nintendo → action-adventure. Nesting gives "expand" a *direction*; the choice is Ari's, provenance-honest.

**Three doors at the wall (not just one).** "You're out" offers Ari: (1) **wait** for more to come in; (2) **expand** up the tree; and (3) **add one yourself** — Ari just proved he loves Tears of the Kingdom by exhausting it, so he's the best-qualified, most-motivated candidate to author more. His question enters as *his own* (personal-first), machine-verified for facts, proven-by-play before it reaches anyone else's set — freely and instantly his, without touching other players' quality bar. For a butt-kicker kid, being invited to *author* at the moment he's proven mastery is a higher status than winning: consumer → contributor.

**INVARIANT — Ari is never served his own questions.** A question the author knows the answer to isn't a question. Ari's authored ToTK questions go *outward* to other players; they never return to Ari. Authoring *spends the question out of his own pool*. This requires an authorship-exclusion filter (`authorId !== playerId`) at every serving surface. It also settles the mastery question cleanly: authoring can't count toward Ari's *play* mastery (he never plays those questions — no performance to measure), so authoring is separate *contributor* standing. The "farm mastery by writing easy self-questions" exploit is structurally impossible.

**Open/at-risk in this case:** does the cost-tripwire → "you're out" → graduation chain actually fire cleanly, or is there a gap where a player gets served 3 marginal questions before the system admits it's out? The tripwire's *threshold* is unspecified — how marginal is marginal enough to stop? That's a real open number (and, unlike a set-size cap, a legitimate one — it's an economic/quality floor, not an arbitrary count).

---

## Case 2 — THE NEVER-DEEP DOMAIN (shallow from the start)

**Who:** anyone who declares a genuinely niche thing — the canonical example, Spy School Books — that only ever had ~12 good questions in it.

**The situation:** *not* exhausted-after-deep-play like Ari. Shallow from birth. There was never depth to mine; the domain is small, full stop.

**What it stresses:** the **floor** (honest machine-drafted stopgap) and the **recruiting hook** — and the prior question of whether the domain is even *worth* a master.

**How the current model handles it:**

- The machine provides an honest, labeled floor so play doesn't block (§3, §4).
- The un-mastered domain becomes a recruiting invitation: *"nobody's mastered this yet — machine-drafted for now — know it well enough to make it great?"* (§4).
- Exhaustion here isn't a climb-down from depth; it's *"this is a small domain and that's fine"* — 12 good questions, played, then the same expand-offer as Ari but arriving faster.

**Why it's distinct from Ari:** Ari's problem is "a deep domain ran dry." This is "the domain was never deep." The design response differs: Ari gets graduation *up* a rich tree; the niche-domain player may get graduation *sideways* (Spy School → other middle-grade adventure) because there may be no deep parent to climb into. Also stresses whether a 12-question domain should exist as its own node or be *absorbed* into a parent from the start (the §6a structure question).

**Open/at-risk:** the model's honesty about small domains is good, but the *economics* differ — a never-deep domain shouldn't trigger expensive refill attempts at all (there's nothing to find). The cost tripwire should fire *early and cheap* here, not after burning budget discovering there's no material. Does the system distinguish "deep domain now exhausted" from "domain that was always shallow"? Today, probably not — worth flagging.

---

## Case 3 — THE SHARED / POPULAR DOMAIN (serving many at different depths)

**Who:** many players play Tennis (Ari among them). A popular, broadly-known domain.

**The situation:** not one player exhausting a domain, but *many players at different depths* drawing from the same domain simultaneously — a casual player wants accessible questions, Ari wants deep cuts, all from "Tennis."

**What it stresses:** the **canonical-vs-personal fork** (§9-Q3) and the **shallow/deep layering** (see the concept-note addition below).

**How the current model handles it — and where it's genuinely open:**

- **Layering (newly sharpened, see note below):** a popular domain needs a solid *accessible base* AND *deep cuts*, because it serves a range. The shallow layer can be machine-drafted-and-checked (the bar is low, generic-competent is acceptable for a warm-up); the deep layer is human-authored (where taste and fabrication-risk actually bite). The player climbs from machine-fine to human-brilliant, and **the mix is the fun** — a game of only deep cuts is exhausting; a game of only gimmes is boring.
- **Canonical vs personal (still open, Q3):** does everyone playing Tennis get *one* canonical set, or *a* master's personal set, or a choice? Shared-popular is where this fork bites hardest — with many players, "whose Tennis?" is a live question that Ari-alone doesn't raise.

**Why it's distinct:** Ari and the niche case are about a domain *running out* for a player. This is about *serving many players well from one domain at once* — the constraint isn't exhaustion, it's *range*. A domain can be far from exhausted and still fail Case 3 if it's all deep cuts (casual players bounce) or all gimmes (Ari's bored).

**Open/at-risk:** the layering resolves the range problem, but the ratio is unknown — how many accessible to how many deep? Josh's own research method (play more, notice the rhythm of games that feel good) is the right way to find it, not theory.

---

## What the three cases test, together

- **Case 1 (Ari):** the *exhaustion → cost-tripwire → honest-out → graduation* chain. Depth running dry.
- **Case 2 (niche):** the *floor + recruiting + early-cheap-tripwire* for domains that were never deep. Small-by-nature.
- **Case 3 (shared):** the *shallow/deep layering + canonical-vs-personal* for serving many at once. Range, not exhaustion.

A model that handles all three is robust. The through-line: **detect the one constraint (remaining good material) via its cheapest symptom (cost), respond honestly (you're out / here's a floor / here's the accessible layer), and always offer agency (expand / claim / climb).**

---

## The sharpest open question the cases surface

**The cost tripwire's threshold is real and unspecified, and it's the linchpin.** All three cases route through "cost tells us we're near the bottom." But *how marginal is marginal enough to stop and say "you're out"* is an unset number — and unlike the set-size cap we deliberately killed, this one is *legitimate* (it's an economic/quality floor, not an arbitrary count). It differs per case: Ari's should fire after genuine depth; the niche domain's should fire early and cheap; the shared domain's may never fire (it's about range, not exhaustion). That per-case tripwire behavior is the most concrete unresolved design question in the whole model, and it's where the next real thinking probably goes.
