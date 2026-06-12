# D-HOME-PACING-01 — Home page pacing & budget model

**Status:** Aligned in discussion. Not yet sequenced into build prompts. Read-and-ratify before any B-prompt is written.

**Problem this solves:** The Home page currently renders every event that happened, in chronological order, with no length ceiling. It reads as a log file, not an edition. Page length is a function of how active the most-active friend was, not a design constant. The fix is not clustering (already rejected in the Group 3 work — fragment copy, killed) and not infinite scroll. The fix is *editorial selection against a fixed budget*, plus *serve-and-overflow* for the question zones.

---

## 1. Core principle — the Home page is an edition, not a log

The Home page has a fixed template with a defined number of slots (a "news hole"). A selection layer decides what fills them. Length is a design constant. Anything that doesn't fit the budget is reached via an explicit overflow affordance, never stacked onto the page.

Three surfaces, three time horizons, no overlap:
- **Home** = today's edition (now).
- **Biweekly ceremony** = the retrospective (last 14 days).
- **Profile / Knowledge pages** = the archive (cumulative).

This division is load-bearing for the rest of the spec: it is *why* the temporal buckets get removed (see §4).

---

## 2. The Home budget (top to bottom)

| Slot | Zone | Cap | Notes |
|---|---|---|---|
| 1 | **Today's Five (hero)** | 1 | Full-width, display-scale, the one loud thing. Everything below is subordinate. |
| 2 | **Direct questions** | 3 served | Serve-and-overflow (see §3). Overflow → "N more →" → direct-questions subpage. |
| 3 | **Playable friend activity** | 4 served | Serve-and-overflow. Actor-interleaved (see §5). Overflow → "N more →" → pending-playables subpage. |
| 4 | **Texture (social connection)** | ~8 | Chronological full-sentence lone events per locked Group 3 spec. Today-and-yesterday preferred, older items backfill to the cap. Reaction affordance lives here. *(Tuned 2026-06-12 from ~5/hard window.)* |
| 5 | **One panel** | 1 | Shared Ground / World Expanding / Grow Your Circle rotate; exactly one per page load. Runs mid-texture, after the third texture row *(tuned 2026-06-12; falls to the page foot when texture is empty)*. |
| 6 | **Composer** | 1 | "Write a Question." Closes the page, as today. |

Caps are serving sizes, not access ceilings. Nothing is hidden; everything overflows to a findable place.

---

## 3. Serve-and-overflow (the dealer model)

The cap is a serving size, not a hard limit on what you can reach.

- Home shows the top N of the pending queue for that zone (3 for direct, 4 for playable).
- Below the served cards: a quiet overflow row — **"6 more from friends →"** for direct, **"5 more →"** for playable.
- Tapping the overflow row opens that zone's subpage (§6).
- Copy register is **abundance, never obligation**. No counts framed as backlog, no urgency, no countdowns. Consistent with close-message principles. "6 more waiting for you," never "6 unanswered."

**Why serve, not stack:** 8 questions rendered as a stack reads as a to-do list from your friends. Served 2 at a time, each gets the framing it deserves — someone made this for you, here it is. A friend's question should never be "item 6 of 8."

---

## 4. Remove the temporal archive

Delete "Past two weeks / Past few weeks / Older" from Home entirely. That retrospective work belongs to the biweekly ceremony, not the home page. Texture items are bounded to today-and-yesterday (§2, slot 4). Older texture moments do not get a home on this page — they are already consumed or expired as moments, and the archive surfaces own anything cumulative.

---

## 5. Selection & interleaving (reconciled with locked Group 3 decision)

**This is selection, not clustering.** The locked Group 3 decision — chronological full-sentence lone events, no per-person clusters, no fragment copy — survives unchanged. We are choosing *which* events run in the playable zone, not restructuring how any event renders.

- Apply the **same actor-interleaving rule already used in the daily assignment algorithm**: no two consecutive slots from the same author where the pool permits. Five "Joshua went deep" rows cannot occupy the playable zone because Joshua cannot hold consecutive slots; the best one or two run, the rest overflow.
- **Degenerate case (one or two actors — the actual launch condition):** when actor variety is unavailable, prefer variety of *event type* (one went-deep, one got-you, one convergence) over actor variety. Three Joshua items selected for type-variety feels like a relationship; eleven feels like surveillance.
- **Serving order within a zone:** rotate by sender, oldest-first within each sender. If Robyn sent 1 and Joshua sent 7, Robyn's does not get buried, and Joshua's seven are spaced across visits rather than arriving as a monologue. No sender's question dies of old age because someone chattier exists.

---

## 6. Overflow subpages

Two separate, back-navigable subpages reached only from Home. Not tabs (the four nav slots are spoken for), not the bell (the bell remains friend invites/requests for now).

- **Direct questions sent to you** — full pending queue, scrollable, answerable in place. Warmer register: someone chose you; relational provenance is visible (who sent it, why).
- **Pending playables** — full pending list, scrollable, answerable in place. Ambient-opportunity register, lighter weight.

Each has a clear back affordance to Home. They are distinct destinations (the streams stay separate per the alignment); each page is one kind of thing, so no internal sectioning is needed.

**Subpage over modal:** these lists can be long and contain answerable, stateful cards — that is a page wearing a modal's clothes. Full subpage with back is cleaner. (A lighter modal treatment for the playables page specifically is defensible if desired, since those are lower-stakes.)

---

## 7. State sync — Home is a window onto the pending queue

Home, the overflow row count, and the subpage all read from the **same pending list**. Home shows the top N of it.

- Answer a direct question *anywhere* (Home or subpage) → it leaves the pending list → Home silently reflects the new top N on return.
- No "you already did this" ghost states, no manual clearing, no per-surface bookkeeping. Shrink the queue; every view recomputes its window from the same source.

---

## 8. Ratified stance (state it out loud)

**Joshing questions don't have read receipts and don't expire on the sender's clock.** A sender cannot assume you saw their question the moment they sent it — it may wait in the deck a day or two. Questions are gifts, not messages; gifts keep. The entire overflow design follows from this sentence. (Ratified in discussion.)

---

## 9. Empty states — the floor (this is the default state, not the edge case)

At launch and for any low-activity group, empty is the *common* state. The budget governs too-much; this section governs too-little.

**The rule is a two-state switch, not per-section logic.** Each content zone deciding its own empty behavior independently produces a patchwork — one zone shown, one hidden, one rendering a placeholder — that reads as broken. Instead:

- **Any of {direct questions, playables, texture} empty, but not all** → **hide the empty ones, render the populated ones.** No per-section placeholders, no "quiet today" in a single slot while another zone scrolls below it.
- **All three content zones empty** → **render the existing codebase empty state**, inline between the hero and the composer. It carries its own invitation; the rotating panel does NOT separately appear in this case.

**Definitions that make the switch precise:**
- "All three" = the three *content* zones only: direct questions, playables, texture. **Hero and composer are never counted** — hero always has a voice (onboarding / ready / done), composer is always present. So even a fully-empty page is hero + empty state + composer, never a blank screen.
- **The panel does not count as content** for this test, and on a fully-empty page it does NOT render alongside the empty state. The fully-empty empty state already *is* the "here's what to do" gesture (it contains the invitation). One invitation, not two — this is the no-double-invite concern, solved by the switch itself.

**Revive, don't rewrite.** The empty-state copy already exists and is locked in the PRD (§8.2.8 / §8.2.12). The prompt's job is to **audit whether the live code still renders it** and wire it to the all-three-empty condition — it does NOT write new copy. The "Quiet today…" / "no friends yet → invite" copy is reserved for the fully-empty case, which is where it was always meant to live; it is retired from the partial case.

**Audit question for the prompt:** confirm the existing empty-state component was built to sit **inline** between a populated hero and a populated composer, not as a full-screen takeover. If it is a full-bleed "nothing here" screen, it will fight the hero above it and needs to be reworked to inline.

**Hero voice is the one always-on variation:** onboarding (brand-new, pre-first-assignment) / ready / done. The hero never disappears regardless of how empty everything below it is.

**Design the fully-empty page first.** It is the page your first 50 users actually see — hero (onboarding voice) + the codebase empty state with its built-in invitation + composer. The full page is its elaboration. If the empty page feels good, every sparser-than-full state above it feels good too.

---

## 10. Rhythm comes from contrast (dependency on tiers)

A budgeted page of same-sized rows is still flat. The tier system (**B-VISUAL-CARD-TIERS-01**) is the rhythm instrument: one hero, a few mid-weight playable cards, quiet texture rows, one panel as a section break. Loud–quiet–loud. The budget controls *how much*; the tiers control *how it breathes*. These are one problem across two prompts — sequence them together.

---

## 11. Suggested sequencing (for discussion, not yet written)

1. **Selection / budget layer** — server-side: which events fill each zone, interleaving, serving order, pending-queue read model, overflow counts. The data contract the Home page renders against.
2. **Overflow subpages** — two back-navigable routes reading from the same pending list; refill-on-return behavior (§7).
3. **Tier rendering** — B-VISUAL-CARD-TIERS-01, already scoped; carries the rhythm (§9).

Decisions locked (2026-06-11):
- **Served caps:** Direct 3, Playables 4. Texture ~5 (still a soft cap, tune in build). *Tuned 2026-06-12: texture soft cap 8, rendered as 3 rows → panel → up to 5 more rows → "See all activity →"; the 48h window backfills with older items rather than starving the zone.*
- **Panel:** rotates one per load, activity-aware (quiet pages bias to Grow Your Circle; never Shared Ground for a user with no overlap data). Suppressed entirely on the all-empty page per §9.
- **Both overflows are subpages** (back-navigable routes), not modals.
