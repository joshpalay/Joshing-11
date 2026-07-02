# D-KNOWLEDGE-TAXONOMY-MODEL-01 — Leaves, Parents, and the Knowledge Graph

**Status:** **SETTLED** (A–E ratified in chat — see §9). Captures the gameplay-first reasoning from the originating chat. Authorizes a `B-KNOWLEDGE-TAXONOMY-*` build slate; §-claims about existing symbols to be re-verified against live `joshpalay/Joshing-11` before any `B-` execution. Coordinate §9-D read-flips with `D-SUPPLY-FINITE-SET-01`.
**Author:** Claude (with Josh)
**Relates to / builds on:** `D-NEARNESS-LADDER-HYBRID-01` (SETTLED — provides the *edges* out of a child: sibling/cousin/parent/grandparent, cached in `DomainRelation`), `D-SUPPLY-FINITE-SET-01` (the finite-completable-set reframe — this doc defines the *territory unit* that reframe depends on), `CATEGORY-HIERARCHY-FINDINGS-01` (audit), the write-path reconcile work on `claude/domain-fragmentation-prevention`.
**Supersedes the framing of:** the flat `canonical_subcategory` model — this doc introduces an explicit intermediate grain between the 13 `broad_category` buckets and raw labels.
**Companion prototype:** `knowledge-map-v2.html` (circle/gallery direction — leaves foreground, tap-to-recenter traversal, color-grouped lineage, Add-to-Daily-5). The list variant was rejected.

---

## 1. Why this doc exists

A player reported (correctly) that "Renaissance Florence is shallow" made no sense when the bank holds many Medici questions. The root cause: **a domain in the current system is a flat string, and every metric treats two different strings as two unrelated universes.** Pool depth, exhaustion, mastery, overlap, ceremony beats all `GROUP BY canonical_subcategory` with only a typographic fold (`domainKey`). "Medici Family" and "Renaissance Florence" are as unrelated to the system as "Medici Family" and "NBA Playoffs."

The fix is not a one-off bug patch. It requires deciding **what a knowledge territory *is* from the player's chair**, and only then extrapolating the data relationships. This doc records that gameplay-first reasoning and the model it produces.

---

## 2. The two players that define the rule

**Josh** enters at a **leaf** (Medici Family). Gets only Medici questions. Earns real mastery there. On exhaustion, offered a sibling (Renaissance Families of Florence) or the parent (Renaissance Italy). If he graduates up to Renaissance Italy:
- must **not** re-see Medici questions (already answered),
- must **not** inherit Medici's mastery as Renaissance Italy mastery,
- must **not** read as a blank slate there either — Medici depth is *evidence toward* Renaissance Italy, so the parent shows **partial progress**.

**Jaime** enters at the **parent** (Renaissance Italy). Gets a **spread** across its children — some Medici, but also Machiavelli, Florentine art, the Papacy, Venetian trade — because at the parent grain the territory *is* the union of its children.

The unifying principle both players force:

> **Mastery lives at the grain you actually answered.** A parent's progress is earned by coverage across its children; a child's answers contribute credit *upward*, but never confer parent mastery on their own.

Same logic governs Hamlet → Shakespeare's Tragedies: all-Hamlet gives meaningful-but-partial Tragedies, never "you've mastered Shakespearean Tragedy."

---

## 3. The non-negotiable differentiator: deep specificity must never evaporate

Joshing's edge is that you can go **very** specific and get real, terminal mastery in a tiny area (Bach's Well-Tempered Clavier; Wagner's Ring Cycle). This must be structurally protected.

**The leaf is the atom, and it never dissolves upward.** Three guarantees:

1. **Leaves are enterable and completable.** You can select a leaf, get only its questions, and reach mastery — no forced graduation, no minimum-breadth requirement. Depth alone is a win.
2. **Leaf mastery is displayed at leaf grain.** The knowledge page keeps the fine node. Mastering WTC never collapses it into "Bach" on the portrait — the specificity *is* the trophy.
3. **Roll-up is one-directional and fractional.** Leaf → parent credit exists (so you're not blank at the parent), but parent mastery **cannot** be achieved from a single leaf, and a leaf's mastery is **never** recomputed or diluted by what the parent does.

A node can be **both** an enterable territory **and** a parent of finer nodes (Bach = leaf you can master *and* parent of WTC, Goldberg Variations, etc.). The model must not force every specific thing to justify itself as a fraction of something bigger.

---

## 4. Structure is human-authored; the LLM only proposes

**Decision (provisional, strong):** the parent↔leaf grouping — who is a parent, who is a leaf, what pairs with what — is a **human decision**, not an LLM output. Rationale:
- It is a slow-changing taxonomy decision (the thing humans are good at).
- It is exactly where the LLM fragments (every question mints a fresh hyper-specific label with no reconciliation — see `CATEGORY-HIERARCHY-FINDINGS-01`).
- It is cheap to author: dozens of parents, not thousands.

The LLM (the existing `nearness-tree.ts` Haiku call) may **propose** pairings/edges; a human ratifies. Players may **select** nodes to steer supply, but **proposing new nodes/edges goes into a suggestion queue a human approves** — never live taxonomy editing. This preserves the anti-fragmentation guarantee.

---

## 5. Parent size & mastery threshold — human-set absolute, never revoked

**Decision (settled in chat):** a human sets each parent's **size and mastery threshold as a fixed absolute number**. Once a player crosses it, they are master **permanently**, regardless of leaves added later.

**Why not coverage-based / emergent size:** Claude proposed "parent mastery = breadth across N leaves, size emergent from leaf count." Josh **rejected** it: if you hold mastery in Shakespeare's Plays because Hamlet was the only leaf, and Macbeth is later added and your mastery is revoked because the denominator grew, that is **frustrating and a lie**. Downgrading earned mastery because the pool grew is a disqualifying UX failure.

**Consequence — the "Shakespeare relative to Hamlet" problem:** the system cannot infer that Shakespeare's Plays should be "extra large" from Hamlet alone. So a human assigns the parent an absolute threshold (e.g. Hamlet mastery = 100 pts; Shakespeare's Plays mastery = 2000 pts) — a size class / threshold the human judges. This is the coarse dial human judgment enters through.

**Open (§9-A):** exact mechanic of *partial* parent progress display given an absolute threshold and a not-yet-complete leaf roster (so a deep-but-narrow player doesn't read as permanently stuck at 15%).

---

## 6. Question tagging — finest node, credit derived

**Decision (settled in chat):**
- **Every question tags to the finest node that exists at write time.** If only "Hamlet" exists, an Act III question tags to Hamlet. If "Hamlet · Act III" is later authored as a child, *new* questions tag there; **old Hamlet-tagged questions do not retroactively re-sort.**
- **A question carries exactly one stored leaf identity.** Parent credit is **derived from the roster, never stored on the question.** Jaime's Macbeth question is stored at Macbeth *and* counts toward Shakespeare's Tragedies (because the roster says Tragedies contains Macbeth) — not either/or, but only one *stored* tag.
- **A node's display = its own directly-tagged questions + rolled-up credit from finer children.** The display must distinguish "answered at this node" from "answered below it."

This one-tag-at-write, roll-up-computed rule is what lets Josh (deep Macbeth) and Jaime (broad Tragedies) share the same underlying questions without either's accounting lying.

Sub-leaf refinement (Macbeth · Act I/II/III) is **allowed by the model but not seeded.** It's the same parent→leaf relation one level deeper; authorize it only where a real specialist would exhaust the leaf and want to go deeper. A supply decision, not a model decision.

---

## 7. It's a graph, not a tree — multiple parents, typed edges

A leaf can have **many parents.** Hamlet sits under Shakespeare's Tragedies, Kenneth Branagh's Films, Elizabethan History, *and* Plays Starting With "H". The model must allow a leaf to belong to multiple parents.

**Hamlet is a hub:** "Hamlet itself" is a node; "Hamlet (the play/text)" and "Hamlet (Branagh film)" are facets branching *off* it, each with its own upward edges (film-facet → Branagh's Films; text-facet → Tragedies). The shared name is one hub, multiple facets — not two coincidentally-named leaves.

**Credit does not flow up every edge identically.** The Plays-Starting-With-"H" case forced this: knowing Hamlet tells you nothing about Henry V or Hedda Gabler, so you can't "understand the subject" of the H-shelf — **but** covering Hamlet + Henry V + Hedda *is* a real demonstration of covering that set. So edges carry **different *kinds* of mastery**, split on **how credit accrues**, not whether:

- **Substantive parent** (Shakespeare's Tragedies): mastery = you understand the body of knowledge. **Depth-eligible** — one deep child gives partial credit because depth is evidence toward the subject.
- **Collection parent** (Plays Starting With "H"): mastery = you've covered the set. **Coverage-only** — each distinct member answered lights one slot; depth within a member does *not* over-credit the collection. Mastering Hamlet ≠ mastering the H-shelf; you still need the other members.

The human authoring the parent picks its **type**, and the type sets how credit accrues. Display says which: "You understand Shakespeare's Tragedies" vs. "You've covered 8 Plays Starting With 'H'."

---

## 8. The knowledge page — circle map, leaves in foreground

The flat list is retired; it cannot express a graph and it buries the vanity payload. Direction (prototype `knowledge-map-v2.html`):

- **Leaves are the bright foreground**, sized to be the headline, brightest when mastered. Wagner's Ring Cycle / WTC read as trophies at full size — the vanity play survives. **Parents are faint upward lineage**, not containers you open to find leaves.
- **Home = a gallery of several leaves**, clustered by parent, **depth-ordered within a cluster**, clusters ordered by the player's strongest leaf. (Josh chose gallery-home + order-by-depth + cluster-by-parent.)
- **One interaction: tap to recenter / traverse.** Tap a circle → it centers, its parent floats up, its existing siblings/children arrange around it. **Unbuilt areas simply aren't promised** (absence reads as "nothing here yet," not a broken grid) — this dodges the empty-early-roster problem.
- **Distant ancestors carried by color, near ancestor by a drawn circle.** WTC + Wagner share the Classical Music hue rather than a stacked great-great-grandparent ring (drawing 4+ ancestor rings fights the layout). Color is always paired with a label — **never color alone** (accessibility canon).
- **Partial credit shown honestly:** Renaissance Italy shows "1 of 5 · a corner lit" off Medici depth. A new sibling cannot downgrade it (per §5).
- **Add-to-Daily-5** affordance on built leaves — the map doubles as the configure/supply surface. Hard cap at 5 (add until full, then swap/rest). This is the interactive hook Josh wanted.
- **Dropped from the prototype at Josh's direction:** dry/barren supply textures, the frequency knob-per-node (as clutter), Acts pips at home, points/reach captions. Kept minimal.

---

## 9. Resolved decisions (A–E) — ratified in chat

**A. Partial parent-progress — fractional credit, hard-capped below mastery until breadth exists.**
- Substantive parent progress = `min(rolled_up_credit, CAP)`, where `CAP` (≈60%) holds until the player has lit ≥2 corners. All-Medici toward Renaissance Italy climbs to ~40–50% and **stops** — visibly "a corner lit, more field ahead" — never creeping toward mastery off one leaf.
- **Crossing into substantive-parent mastery requires BOTH:** (1) the absolute point threshold (§5) **and** (2) **≥2 substantive corners lit.** Points alone cannot confer parent mastery — this is the mechanism that enforces "all-Hamlet ≠ master of Shakespearean Tragedy." Breadth gates depth here and only here.
- Collection parents are exempt from the point/cap logic — they are pure coverage already (§7); their "progress" is simply members-covered / roster-size.

**B. Roster is a fixed human-authored list; growth only adds unlit corners, never revokes.**
- A parent's child roster is authored, not emergent (avoids the drift §5 rejected).
- A newly-authored leaf enters as a deliberate, logged act that **only adds an unlit corner** — it never recomputes existing mastery. A player who was master stays master; the new leaf is an *available* corner, not a retroactively *missing* one.
- **Coverage fraction is live only until the threshold is crossed, then frozen.** Non-master: roster growth updates the displayed fraction (1/5 → 1/6, honest — the field grew). Master: the fraction is frozen; mastery is terminal and roster growth cannot re-open it.
- Ceremony surfaces growth positively ("Renaissance Italy grew — a new corner to explore"), never as a downgrade.

**C. Extend `DomainRelation`; add one node table; no question migration.**
- **`DomainRelation`** (exists): add `edgeType` column (`substantive | collection`). Parent/grandparent rows serve as the roster's inverse — query parent→children via `related_domain = X AND rung = 'parent'`.
- **New `KnowledgeNode` table:** `id`, `label`, `domainKey`, `nodeKind` (`leaf | parent | both`), `masteryThreshold` (absolute, human-set; null → default for pure-parents), `broadCategory`, `fieldHue`.
- **Threshold + edge type live on node/edge, never on the question.** Questions keep their single `canonical_subcategory` tag (= finest node's key). **No question backfill** — this is what makes §6 cheap.

**D. Which surfaces read roll-up vs. leaf-exact:**

| Surface | Reads | Rationale |
|---|---|---|
| Pool depth / exhaustion (`getDurablePoolDepthForDomains`) | **cluster** | fixes "Florence is shallow" — depth = leaf + descendants |
| Crafter heat | **cluster** | stop flagging "thin" when siblings hold the questions |
| Mastery — leaf | **leaf-exact** | the trophy is the leaf; never rolled |
| Mastery — parent | **roll-up** (per §A) | fractional credit + ≥2-corner gate |
| Ceremony Beat 1 (promotions) | **both** | leaf *and* parent promotions fire, labeled distinctly |
| Ceremony Beat 4 (alignment/overlap) | **cluster** | **the original complaint** — Josh/Ari share a *cluster*, not an exact string. Highest-value flip. |

Coordinate with `D-SUPPLY-FINITE-SET-01`: the finite set's territory boundary = the cluster unit defined here.

**E. Graph-at-read for credit; one home-parent for layout.**
- **Credit:** walk **all** substantive edges up from a leaf; apply full fractional roll-up to **each** substantive parent (full credit to each, not split — a Hamlet question genuinely teaches Tragedies *and* Elizabethan drama). **Collection edges are skipped for depth credit** but light their coverage slot.
- **Layout:** each leaf has a `homeParent` (first substantive edge) for gallery clustering; other memberships surface only on traversal into that parent (prototype behavior — Hamlet clusters under Tragedies, appears under Branagh only when you tap there).

---

## 10. Guardrails carried from canon

- Grading/accounting must **fail toward the player** — a falsely-assigned wrong (or a falsely-revoked mastery) is a product betrayal.
- **Never revoke earned mastery because the taxonomy grew** (§5).
- **Color never conveys meaning alone** (§8) — hue always paired with label.
- **Human authorship of structure**, LLM proposes only (§4) — the known fragmentation failure mode.
- **Live code is source of truth** over any doc; §-claims about existing symbols to be re-verified against `joshpalay/Joshing-11` before any `B-` build.
