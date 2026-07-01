# CONCEPT NOTE — Master-Authored Canonical Question Sets

**Status: THINKING IN PROGRESS. This is NOT a decision record.** No decisions here are ratified; several central questions are deliberately left open (§9). Do not write build prompts or D-docs from this note. Its job is to hold the shape of a new direction while it settles, so Josh can react to the whole thing at once rather than assembling it from a chat transcript.

**Supersedes as direction:** the finite-set framing captured in `docs/decisions-pending/D-SUPPLY-FINITE-SET-01-PENDING.md`. That marker's core question ("finite sets vs infinite topup") is answered here — finite — but the authorship model has changed enough that the pending doc should point here.

**Reinforces (does not lift):** the supply pause (`CC-SUPPLY-HALT-01`). Everything here makes the paused automated-refill pipeline less central, not more. Nothing here unpauses a paid run.

---

## 1. The core inversion

Every supply model we've built until now makes the LLM the author and the human (or the quality gates) the safety net catching its mistakes. Testing repeatedly showed the LLM is a disappointing author for this product: it grades wrong, it doesn't know what's important, and it doesn't know what's clever. Those aren't tuning problems — they're taste problems, and taste is the one thing the product is actually about ("the people who get you, getting you").

This note inverts the authority:

The human is the author and canon-holder. The LLM is demoted to staff — a research assistant that drafts candidates, a fact-checker that verifies, and a copy editor that handles wordings. It never decides what is worth asking.

The machine does what it's genuinely good at (volume, verification, rephrasing). The human does the one thing the machine has failed at (judgment about importance and cleverness). This is why it "feels better" — it's not a new ratio of human-to-machine, it's a reassignment of authority.

### 1a. Why the pivot — QUALITY, not present cost (corrected by V4)

(Correction, from the pre-build V4 investigation. An earlier framing justified this pivot partly on cost — "grounded refill costs ~$0.39/kept question, human curation ~$0.004, so curation is ~90× cheaper." V4 checked the live per-user path and that framing is misleading for the near term.)

The floor players actually hit today is already cheap. With `RETRIEVAL_GROUNDING_ENABLED=false` (the current, paused state), the per-user path is: bank reuse (free) or plain ungrounded Sonnet generation (~$0.004–0.02/kept). Grounded generation (the ~$0.39 path) lives only inside the paused refill cron and never runs on the live per-user path. So near-term supply cost is already low; the pivot does not save present dollars.

Two consequences that correct earlier docs:

- "Un-pause refill as a cheap floor generator" is a category error. Refill is the grounded/web-search path — intrinsically the ~$0.39 mechanism. There is no cheap-floor variant to bring back; the cheap floor already exists and runs by default. Turning refill on adds cost.
- The $215-vs-$2 comparison is true only about the grounded path, which isn't what's running. It stops being the headline reason for human authoring.

So the real justification is QUALITY — specifically, anti-fabrication. The cheap floor is cheap because it's ungrounded, and ungrounded Sonnet fabricates facts on thin niche domains (the Spy School / "six-book series mined past its real facts" hallucination). That fabrication — a real fan graded wrong on invented canon — is the one failure the product cannot tolerate. Human authoring fixes exactly that. The pivot is worth doing because it's better and non-fabricating, not because it's cheaper. That's a stronger justification (anchored in fail-toward-the-player canon) than the cost one, and it's the honest one.

Clean supply-pause rule (from V4): present cost never justifies un-pausing refill — the floor is already cheap. The only trigger to bring grounding back is a deliberate choice to pay for fabrication-prevention on thin declared domains, budgeted as an added expense, not a saving.

---

## 2. The model, in one worked example (Paradise Lost)

1. A master starts a domain — no fixed target. (Reversal, recorded: an earlier draft had the master "size the domain" at ~50 questions. That's dropped — see §2a. There is no target number; the set is however many genuinely good questions exist.) Robyn begins contributing Paradise Lost questions; the set is as large as the good questions that accrue, no more.
2. The LLM drafts candidates. It generates a batch of possible questions — cheaply, at volume, across the difficulty range. This is a starting pile to react to, not a finished product.
3. The master judges and tweaks. Robyn keeps the ones that hit the real depth, kills the generic ones, and sharpens the almosts. Her keep/kill/tweak authority is total and permanent. Nothing she doesn't approve enters the set.
4. The LLM verifies, rewords, and dedupes. For approved questions, the machine fact-checks (existing batch-verify machinery), generates acceptable-answer variants and alternate phrasings so grading fails toward the player, and flags near-duplicates. It may touch form, never substance.
5. The set is shared, and grows. Those questions are available to everyone who declares Paradise Lost — and the set keeps growing as contributors add good questions. Authored by experts, no daily pipeline, no "keeping up with demand" — but not frozen: it's a living set, not a finished count.

What this dissolves: the entire supply problem, for every mastered domain. No daily pipeline, no backlog to drain, no five-rung fallback ladder.

### 2a. Mastery is performance-based, not completion-based (settled reversal)

An earlier version of this model rested on completion: a master sizes the domain (~50), the player finishes the set, earns a designation, graduates. That's reversed. Two problems killed it: (1) nobody can honestly say a work "has" 50 vs. 80 questions worth of mastery — the number is arbitrary; (2) a fixed target creates a padding incentive — 40 good questions plus 10 mediocre fillers to "complete the set," which is exactly the generic-filler failure this whole pivot escapes.

Instead: mastery is a threshold on how well you've performed across whatever questions exist — points/accuracy, not exhausting a fixed list. If Paradise Lost has 40 great questions, it has 40; you don't manufacture a 50th. If contributors grow it to 90, it's 90. Set size is an emergent property of contribution, not a pre-set target. "If the list is exhausted, so be it" — you've shown mastery by answering well across what's there, whether that's 40 or 90.

This is more coherent, not less: one signal now does three jobs — the player's mastery designation, the qualification to contribute/evaluate (§6), and the graduation trigger — all "answered well across the domain," all performance, none completion. It also removes the last arbitrary human number from the model (the set-size judgment), leaving humans only the judgments they're actually good at: which questions are good, and (optionally, §6a) how a domain is shaped.

---

## 3. The LLM's surviving jobs (narrow, and it's good at all of them)

- Draft candidates for a master to react to (volume; the master never faces a blank page).
- Verify facts — the `batch-verify-questions` cron already exists and does exactly this (knowledge-first, web-search fallback, demote-only).
- Reword for fair grading — acceptable-answer variants, alternate phrasings. The schema already holds these (`acceptedAlternatives` on `questions`, `acceptableVariants` on `generatedQuestions`).
- Dedupe — flag near-duplicate questions. Mechanical judgment (is this the same question), not taste judgment (is this question good), so it fits the staff bucket. Machinery exists (`factKey`, `isDuplicate`, `suppressedBy` on `generatedQuestions`, plus embedding dedup from the pool work). One social nuance in a multi-contributor domain (§6): dedup is contributor-facing, not just hygiene — when a new contribution overlaps an existing one, the right surface is "this overlaps an existing question — sharpen the distinction or withdraw?", never a silent rejection that makes a contributor feel unheard.
- Provide the honest floor for un-mastered domains — see §4.

Note the machine is never on the critical path of quality. It drafts, checks, and rephrases. The master decides.

### 3a. Shallow/deep layering — the human/LLM split maps onto difficulty (a correction)

(Prompted by Josh playing a game he enjoyed and noticing: a good game needs a MIX, not all hand-crafted gems. An earlier over-rotation of this note drifted toward "every question should be a human-authored gem" — which would be exhausting to play, the "answering ever deeper leads to weirdness and frustration" feedback arriving from the other side.)

The refinement: the shallow/deep split maps onto the human/LLM split, and that's a better division of labor than "humans do everything good."

- Shallow questions — accessible, warm-up, "everyone who likes this thing knows this" — are fine for the LLM (or fast for a human to knock out). The bar is low by design: a shallow question is supposed to be gettable, so generic-competent is acceptable, and the LLM's weakness (no taste, generic output) doesn't bite.
- Deep questions — arcane, discovery-rich, "only a real fan knows this" — are where human authorship earns its keep, because that's where taste matters and where the LLM's fabrication-risk and register-dead misses actually hurt.

This resolves the old tension about "machine does easy, human does hard" (which I'd worried put scarce human time on the deep end): if the game wants a mix — if shallow questions are load-bearing for rhythm and fun, not filler — then the machine handling the shallow layer isn't wasting it on junk; it's the machine doing the part where its output is good enough, freeing the human for the part only they can do well. The mix is the fun (a game of only deep cuts is exhausting; only gimmes is boring).

So a domain is a layered set: a machine-drafted-and-checked accessible base + a human-authored deep tier, in the same domain. The player climbs from machine-fine to human-brilliant. This folds a provenance dimension into the earlier difficulty/arcanitude tiers — and it may make an explicit quality "rating" unnecessary, because the tier already encodes it: the deep tier is the set of gems, structurally, not via a star someone adds. (Ratings: still open, but layering weakens the case for a separate player-facing rating — see the ratings discussion, unresolved.)

---

## 4. The coverage tradeoff — and why the gap is a feature

This model produces excellent content where a master exists, and nothing where one doesn't. That's a sharper, better product in covered domains and an empty one at its edges. Faced honestly:

When someone declares a domain with no master yet, the LLM provides a provisional set — honestly marked as machine-drafted, not master-authored — so play never blocks. And that un-mastered domain becomes a candidate for someone to master. The machine-drafted set is simultaneously the stopgap and the invitation:

> "Nobody has mastered this yet — these questions are machine-drafted for now. Do you know it well enough to make them great?"

So the model's weakness (empty edges) generates its growth mechanism (masters step in to fill them). The gap in coverage is the recruiting funnel. This is the contributor/evaluator idea arriving not as a Phase-2 nicety but as a core structural mechanism: every domain has (or wants) a master, and mastery is how questions come to exist.

---

## 5. Authoring as a social act (this may be the real center)

Everything above treats authoring as content supply — a master stocks the shelves so the game has good questions. Useful, but slightly thankless, and it undersells what's happening. Reframed:

Authoring a set is a social act — a gift, an invitation, a "this is me — do you know this part of me?" "Hey, I made a mastery list of Tom Sawyer questions — wanna try them?" said to a friend.

This lands directly on the north star. The product's thesis is that shared specific knowledge is a bonding mechanism and the reward is being known by people who share your world. A hand-made question set about a thing you love, handed to a friend, is that thesis performed by a person. The set stops being inventory and becomes a love letter you can give someone.

It also aligns authoring with the wrong-answer-as-connection mechanic that started the whole product. In the supply framing you write questions so strangers can play; here you write them for your friends, and you want them to hit the questions they don't know — because that's the moment you get to share the part you love ("oh, you don't know this about Tom Sawyer? here —"). The author and the player are now on the same side of the wrong answer. The two core ideas finally point at the same thing.

And it warms up the coldest open question. §9-Q1 (how is mastery earned — the bootstrapping/recruiting problem) had a bureaucratic answer: seed masters, mastery-by-play credential. The social framing gives a warmer one: you become a master of Tom Sawyer by making a Tom Sawyer list your friends love. Authorship isn't a rank the system grants; it's a thing you do because you love something and want to share it. The credential is social proof (people played it, it was great), not an arcane-tier score. That's a more on-brand genesis, and it turns the recruiting funnel from a game mechanic (fill the empty domain) into a human motive (I want to share this).

But it opens a real fork (now §9-Q3, unresolved): is an authored set canonical-and-shared (one authoritative set per domain, for everyone) or personal-and-gifted (mine, many can exist, I share with whom I choose)? These have different schema and product consequences and shouldn't collapse by default toward whichever gets built first. A candidate reconciliation — they coexist, distinguished by who it's for, with personal gifting as the on-ramp and canonicalization as what the best-loved lists earn — is sketched in §9-Q3, but it is not decided here.

This section may be the note's real center of gravity: the shift from supply model to social object. The rest of the model (LLM as staff, finite sets, verification) still holds — but its purpose is reframed from "stock the game" to "let people share what they love and be known for it."

---

## 6. Contribution → mastery → evaluation (the loop that makes it self-propagating)

The model so far still has a genesis weakness: it asks someone to author a whole set cold before they've done anything — a bar only the already-confident expert clears. Josh's mechanism turns that gate into a slope:

You don't arrive as a master. You contribute — a few good questions to a domain — and standing accrues from contributions that are kept and hold up. Mastery is something you accumulate by participating well, not a gate you're admitted through.

This is a genesis for the becoming-expert (almost everyone), not just the already-expert (a few). It also changes how un-mastered domains fill: not by waiting for a hero to author fifty questions in one sitting, but by accretion — many people each contribute the pieces they know, and the good pieces aggregate. That's how shared fandom knowledge actually forms; nobody is the master of Tom Sawyer, lots of people hold pieces, and the best pieces rise.

The load-bearing constraint (or this becomes the farm you rejected):

Mastery accrues from contributions that are KEPT and HOLD UP — never from contributions made. Volume is invisible. A rejected contribution earns nothing; a contribution that gets played and turns out flat earns nothing. Quality is the only currency.

That single rule is the difference between this and every trivia-farm. Rewarding submission rebuilds the engagement grind and the status-competition the whole product is a reaction against. Rewarding kept-and-held-up rewards exactly the fan-taste the product is about.

This merges the contributor and evaluator roles into one track. If a contribution must be judged worth keeping to count, someone judges it — and the natural judge is whoever already has standing in that domain. So the roles aren't two systems; they're one loop that grows a person along a single path:

newcomer → contributor (adds pieces) → master (enough kept standing to shape the domain & evaluate) → evaluator (judges others' contributions) — each stage earned by the quality of the last.

The seed masters (Josh + trusted few, by fiat on day one) bootstrap the first evaluations; after that the system generates its own masters from its own contributors, who then evaluate the next wave. It's self-propagating — the thing the model was missing, a reason it grows rather than depending forever on Josh anointing people.

When does contribution get invited? When a player runs out. (Josh's insight — it gives the loop the trigger it lacked.) Every "you're out of these questions" moment (§6c) is the most natural possible prompt to contribute: the player who just mined a domain to the bottom is the best-qualified and most-motivated candidate to author more of it — they've proven deep engagement by exhausting it. So the exhaustion wall becomes a recruiting moment aimed at exactly the right person: "you're out — but you clearly love this. Add one yourself?"

This is especially good for a player like Ari (the butt-kicker kid): offering authorship at the moment he's proven his knowledge says "you know this well enough to teach it now" — a higher, different status than winning, and it grows a consumer into a contributor.

Where the added question goes (the discipline that protects the bar): a player is not a vetted master, so their question cannot drop straight into other players' canonical sets — that would reintroduce the exact quality problem the pivot removed, just with a person as the source. So it enters as a contribution, not canon: it's theirs immediately (in their own personal set, and any friends they share with), and it follows the normal path — machine-verified for facts, then proven-by-play, then maybe judged into the shared/canonical set by someone with standing. Personal-first means the player contributes freely and instantly (satisfaction, zero gatekeeping friction) while other players' quality bar stays protected (their question doesn't touch anyone else's set until earned). This is the personal-vs-canonical fork (§9-Q3) doing useful work, and it's also the safe default for a minor authoring content: authoring for yourself needs little review; authoring for others is the earned, vetted step.

Open (resolved by the §6c invariant): does a player's self-authored question count toward their own mastery? No — and not by choice but by force: the "a question is never served to its author" invariant (§6c) means the author never plays their own questions, so there's no performance to measure, so authoring cannot feed play mastery. Authoring is its own contributor standing, separate from play mastery. (The gameable failure — write easy questions about yourself to farm mastery — is structurally impossible, because those questions never reach you.)

Where the difficulty actually moves (this is now the real open problem — see §9-Q1): the whole loop rests on the judgment step. "Kept and holds up" is only as good as who decides kept and how — and that difficulty concentrates hardest early, before a domain has its own masters. The machine can verify facts but explicitly cannot judge importance or cleverness (the entire reason for this pivot), so machine-evaluation of contributions would reintroduce the taste-blindness being fled. Two evaluation signals exist and trade off: a master's snap judgment (fast, subjective) vs. played-and-proven (a question held up across many players — more reliable, because it's the crowd who love the domain voting with their play, but slow). How those combine into "this contribution counts" is the productive next question — and a far better one than the circular "who can possibly be the first master" the model started with.

### 6a. Optional nested domains (a refinement, not the spine)

Knowledge isn't flat. Hamlet is part of Shakespeare; Spy School is part of middle-grade spy fiction. The flat "each domain an island" model has been quietly straining against this — it's why "graduation" and "broadening" felt hand-wavy (broaden to what?). Josh's insight: a master can say "Hamlet should be part of Shakespeare, and count as a certain percent of it — true Shakespeare mastery requires performance across all the plays."

Held as OPTIONAL, not mandatory (Josh's call, and the right one). A domain nests only when someone with standing sees real structure worth capturing. Shakespeare has obvious internal shape → a master decomposes it. Spy School is just Spy School → nothing forces it into a tree. Mandatory nesting would reintroduce the arbitrary-judgment problem we just killed (where does Spy School "go"? — as made-up as the "50 questions" number). Optional nesting puts structure only where it's real. Flat is the default and the base case; nesting is an additive enhancement.

What it earns where it's used:

- Graduation gets a direction. You don't broaden into the void — you climb. Master Hamlet → the natural next is the rest of Shakespeare. The tree says where "broader" is.
- Mastery composes. Shakespeare standing = weighted sum of standing in Hamlet + Lear + the sonnets + … A Hamlet obsessive who's never touched the histories correctly is not a Shakespeare master — the model knows that. This is a richer, truer mastery definition than a flat score.
- A second legitimate master job. Beyond authoring questions, a master can define a domain's structure and weights — and unlike set-size, this is genuine taste-expertise ("how much of Shakespeare mastery is Hamlet" is a real scholarly opinion), not an arbitrary number.

Discipline — separate the model from the implementation, but don't understate the model. (Correction: an earlier draft said "two levels delivers ~95%." That conflated model with build. The model is a deep tree; two-level was only an implementation-phasing suggestion.) Josh's real chain shows the depth:

Harry Potter Book 3 → Harry Potter series → J.K. Rowling → Modern Fantasy Books

Four levels, each a coherent, playable domain in its own right, each a place a player could hold mastery and a crafter could author. So:

- The model is an arbitrary-depth tree — domains nest as deeply as the knowledge actually nests (still optional: only where a master sees real structure; a flat Spy School stays flat). Every node is simultaneously something to master, something composed of children, and something that composes upward. "J.K. Rowling" is a parent of Harry Potter, a child of Modern Fantasy, and a masterable domain itself.
- Graduation becomes a climb with a summit. Master Book 3 → the series → Rowling's other work → the whole genre. Not one step into the void — a real ladder of increasing breadth.
- The build can start shallow without lying about the model. Recording a parent per node gives you the full tree cheaply (Book 3's parent is the series, the series' parent is Rowling, …). The deferrable part is the upward-composition math (mastery rolling all the way up), not the structure. Structure is deep from day one; composition is phased in.
- Coverage caps, commissioning, and graduation all become per-node up the whole chain (§6b) — "Book 3 needs 10 more" at the leaf, "the series is well-covered" at a middle node, a Rowling-level crafter commissioning across her whole body of work. The tree gives those controls their resolution.

Three tensions depth amplifies (open — added to §9): depth doesn't create new kinds of problems, it exercises the existing ones harder, which is reassuring (the same mechanisms extend):

- Who authors the structure at each join? Someone decides Book 3's parent is "the series," and the series' parent is "Rowling" rather than "1990s fantasy." Deep trees have more structural forks → the §9-Q1 structure-dispute problem gets bigger, same evaluator mechanism resolves it.
- Do weights compound all the way up, or one level only? If Book 3 is 15% of the series × series 60% of Rowling × Rowling 8% of genre ≈ 0.7% — is that a number anyone endorses? Deep multiplication of human-estimated weights can produce values nobody meant. Real open decision: multiplicative all-the-way-up composition vs. one-level-only rollup.
- Where is the tree's natural bottom? Genre → author → series → book → chapter → paragraph? Nesting should go as deep as mastery is meaningful at each level and stop where it becomes taxonomy for its own sake. "Book 3" is masterable; "Chapter 7 of Book 3" probably isn't. The tree has a natural floor, not infinite descent.

Because it's optional and additive, the flat model still ships and proves out first; nesting (and then composition) land later without blocking anything.

Open tension (same one, new place): who sets the weights, and what if two masters disagree on the tree's shape (Hamlet is 15% vs. 25% of Shakespeare; Harry Potter under "Rowling" vs. directly under "Modern Fantasy")? Not a new problem — the §9-Q1 evaluator problem applied to structure instead of questions. One mechanism, two applications.

### 6b. The crafter's workbench (the near-term authoring surface)

The workflow Josh actually wants isn't "review a pile of machine drafts" — it's a worklist where the machine scaffolds and the crafter writes. Five functions, and every one keeps the machine as staff and the crafter as the authority (it shows, offers, drafts-on-command, and flags; the crafter judges, directs, and decides):

1. Coverage map — where the holes are in a domain (passive; turns a blank page into a checklist). When a node is well-mined there are simply no holes left to surface — the map is just full.
2. Cue feed — the machine surfaces salient fact-hooks for the holes ("Abdiel is the only seraph to refuse the rebellion"); the crafter picks which are worth a question and writes it. Machine supplies raw material, never the question.
3. Commission — "Book 3 needs 10 more — find them." The crafter aims the machine at a specific sub-node; it drafts into that narrow frame (where its draft quality is highest because the specification does the hard part); drafts flow into normal keep/kill/tweak. Crafter-initiated, targeted — inverts who starts. Attaches at any node up the tree (§6a): commission at Book 3, the series, or the Rowling level.
4. Flag dashboard — tend what's challenged over time. Merges the two quality streams that currently live apart: player reports (`contentReports`) and machine demotions (`needs_review` / `verificationVerdict`). Per-question actions: uphold-and-fix, edit, dismiss-and-restore, retire (soft tombstone, never delete). Machine flags; crafter decides. (Largely a surface over already-built infrastructure — likely the cheapest and first panel to build; today the batch-verify cron demotes into a state no human ever sees.)
5. Expansion rail — adjacencies the machine spots from what the crafter is writing ("Milton's politics → English Civil War; the epic invocation → Homer"), which become candidate next domains. Makes the crafter's enthusiasm the engine of coverage growth; the tree (§6a) grows behind them as they write.
6. Demand panel — "where your craft is wanted." Domains ranked by demand × shallowness: where players are active AND the set is thin. Turns the workbench from reactive (fix flags) to proactive (here's where authoring produces the most player value). Phase 1, not later — the telemetry already exists: `getThinActiveDomains` / `getDurablePoolDepthForDomains` (`retrieval-demand.ts`) already compute thin-and-active domains (built for the refill pipeline; same intersection, different consumer — feed the list to the crafter instead of the machine), and `declared-interests` / `PLAYER_MASTERY` / `MASTERY_EVENTS` carry the demand side. A player hitting the bottom of a domain (Ari in Tears of the Kingdom) is the demand signal — the wall a player hits becomes the crafter's commission prompt. Guardrail — invitation, not obligation: framed as "here's where you're wanted, if you want it," shown alongside the crafter's own declared loves, never "make what's popular" (that's the engagement-farm register the product rejects). (Two small open decisions: what "demand" means for a crafter worklist vs. what it meant for a refill budget; whether "shallow" counts human-authored depth, not just machine-pool depth.)

No cap, no target — "done" is a discovered state, not a declared one. (Cut: an earlier draft had a "coverage cap" — "50 Book 3 questions is enough." Removed. It was solving a problem the pull-based design already prevents, and it smuggled a fixed number back in after §2a killed one.) The machine never pushes for more — commissioning is crafter-initiated, so there's no nagging to cap. A node is done when new candidates stop being worth keeping — whether because none good remain (the well is dry) or the remaining ones are mediocre (below the crafter's bar). Both are the same signal, and it's just keep/kill judgment doing its job: commission 10 more, keep 1 and kill 9, and the node is nearly mined; a round or two of that and you stop, organically, no button. The set is as large as the questions that clear the bar — an exhausted set, which is a stronger completeness claim than a capped one ("these are all the good ones," not "I chose to stop at 50").

The machine may observe dryness ("the last 15 candidates were all rejected or near-duplicates — this node looks well-mined") — an observation that informs, never a decision that declares. The crafter concludes; the machine reports. This keeps the authority split intact and needs no new control.

Guardrail preserved (§2a) — this is crafter effort, never a player bar: "done" governs when the crafter stops authoring. It never sets how many questions a player must answer. Players master a node by performing well across whatever exists (40 or 90), never by finishing a count.

### 6c. Quality, cost, and availability are one constraint (the spine)

(Josh's framing, and it may be the whole problem stated plainly.) As a player mines a domain deeper, the remaining questions get harder to find (availability ↓), more expensive to generate well (cost ↑ — more search, more fabrication risk), and worse (quality ↓ — the arcane bottom is where generic-competent turns wrong-or-dull). These three don't degrade independently — they're three faces of one quantity: how much good material is left in a domain for a player. All three go bad together because all three measure the same thing running out.

Operationally, this gives exhaustion a detector: cost is the cheapest-to-measure face, so it's the tripwire. When generating one more good question costs more than it's worth, that economic line is exactly where the system stops pretending and says "you're out." Cost isn't a separate problem to optimize — it's the signal that the domain is exhausted for this player.

And the honest response is always the same, and it's a feature, not an error: "You've played through the good ones — that's finishing a finite thing, not a failure. We'll tell you if more come in. Meanwhile, where do you want to expand?" Every alternative is a lie (fabricate → the grading betrayal), a betrayal (serve dreck → kills the fun), or a dead end (silently stop). Running out, said honestly, hands the player agency. The machinery for that moment already exists in this model: exhaustion-as-discovered-state (§6b), the contribution loop for "more come in" (§6), and graduation-climbs-the-tree for "where to expand" (§6a).

Three doors at the wall, not one. "You're out" should offer: (1) wait — we'll tell you when more come in; (2) expand — climb the tree to a broader domain; and (3) add one yourself — you clearly love this, contribute a question (§6: enters as the player's own, personal-first, verified and proven-by-play before it reaches anyone else). The third door turns the moment of scarcity into a moment of creation, aimed at the person best qualified to author more (they just exhausted the domain). It is the contribution loop's natural trigger.

INVARIANT — a question is never served to its author. Authoring spends the question outward: a self-authored question leaves the author's own pool (the author knows the answer — serving it back isn't a question, it's a formality that would inflate mastery and poison the north-star wrong-answer signal). Ari's Tears of the Kingdom questions go to other players; what flows back to Ari is other people's questions. This mirrors §5 (you'd want to play Robyn's Paradise Lost, not your own) one level down, and it's what makes authorship social rather than solitary — a gift you keep isn't a gift. Mechanically: an authorship-exclusion filter (`authorId !== playerId`) at every serving surface (daily five, catch-up, friend-play) — an easy invariant to state and easy to forget to enforce everywhere, so it's written as a hard requirement, not an intention. It also resolves the open mastery question: authoring cannot count toward play mastery, because the author never plays those questions — there's no performance to measure. So authoring is necessarily its own contributor standing, separate from play mastery — forced by this rule, not merely chosen.

The concrete open question this surfaces: the cost tripwire's threshold is real and unspecified — how marginal is marginal enough to stop? Unlike the set-size cap we killed (§2a, §6b), this is a legitimate number (an economic/quality floor, not an arbitrary count), and it likely differs by situation. See `PROBLEM-CASES.md` — Ari (deep exhaustion), the never-deep niche domain, and the shared-popular domain — for the three shapes this constraint takes and how the tripwire should behave in each. That companion doc is the test suite this model should be held against.

---

## 7. The learning loop — the good version and the trap

Josh's addition: the LLM might get better at a domain over time by watching what the master keeps and kills. There is a prize version and a trap version, and they must not be confused.

The prize (do this): the LLM learns to generate better candidates. Every keep/kill/tweak is a free labeled example — and tweaks are the richest signal (a paired before/after showing the direction of the master's correction). Fed back into the drafting prompt as in-context examples ("here's what this master kept, here's what she rejected — draft more like the kept"), the keep-rate climbs over time. Cheap, immediate, works with a handful of examples.

The trap (never do this): the LLM learns to judge — pre-filtering or auto-approving candidates before the master sees them. This silently re-inverts the authority §1 just established. The machine would learn a proxy for the master's taste (surface features) and confidently filter out the brilliant unusual question that doesn't fit the pattern — sanding the taste toward the machine's approximation of it. The machine may learn to generate, never to judge. The master sees every candidate, forever.

Two guardrails on the learning:

- Per-master, per-domain, never pooled. Robyn's kept examples shape Robyn's Paradise Lost drafts — full stop. Pooling "what makes a good question in general" across masters reproduces exactly the generic-competence failure this whole model escapes. The machine learns a specific person's taste for a specific work, never "good questions."
- Sample-size honesty. Early on, a domain yields only dozens of decisions — too thin to train anything. The near-term mechanism is in-context examples in the prompt, not fine-tuning. Heavier tuning is explicitly deferred to "if this whole model proves out and a domain accumulates hundreds of labeled decisions" — a future question, not a now one.

---

## 8. What already exists that this fits (verified against live schema)

The schema partly anticipated this. `trustTierEnum` already has the values this model needs:

```
'unverified' → 'machine_verified' → 'human_validated' → 'author_confirmed'
```

A master-authored question is naturally `author_confirmed`; a machine-drafted floor question is `unverified` or `machine_verified`. The trust ladder to distinguish master-authored canon from machine floor already exists in the type system — this model would give those upper tiers their real meaning. Similarly, `batch-verify-questions` (verification) and the `acceptedAlternatives`/`acceptableVariants` fields (rewording) are built and directly reusable. The machine's three surviving jobs are largely already-built infrastructure; what's new is the authorship surface and the authority inversion, not the plumbing.

---

## 9. The open questions (genuinely unresolved — this is the "more thought needed")

These are the human-layer questions. None block thinking; all block building. They are the reason this is a concept note and not a decision doc.

**Q1 — How does the contribution→mastery→evaluation loop actually judge contributions — especially early, before a domain has its own masters?** (This absorbs the old "how does someone become a master" and "what if masters disagree" — §6 turned those from a gate into a slope, and the difficulty moved to the judgment step.) The genesis circularity is largely resolved by §6: you don't audition as a master, you accrue standing from kept-and-held-up contributions, and seed masters bootstrap the first evaluations. What's genuinely open is the judgment step the whole loop rests on:

- Who evaluates before a domain has masters? The machine can verify facts but explicitly cannot judge importance or cleverness — so machine-evaluation reintroduces the taste-blindness being fled. Seed masters must carry early evaluation, which is the throughput ceiling on how fast un-mastered domains grow. Real constraint, not a flaw.
- Fast vs. reliable signal. A master's snap judgment (fast, subjective) vs. played-and-proven (a question held up across many players — reliable, because the crowd who love the domain vote with their play, but slow). How these combine into "this contribution counts toward your standing" is the design.
- Keeping a bad master out / handling a wrong one is now downstream of this: standing is earned by kept quality and can presumably erode, and multiple contributors per domain (the accretion model) means no single dictator — but the erosion/removal mechanics need design. (Also connects difficulty tiers to the credential — clearing a deep/arcane tier could be one mastery signal among several.)

**Q2 — How far may the LLM's "help with wordings" reach into the master's intent?** The master wrote the question; the machine generates variants and rephrasings for fair grading. If a rewording subtly changes what is being asked, the copy editor has corrupted the author. The boundary — machine may add acceptable answer variants but never alter the question's substance — must be a hard line, or the model loses the thing that made it better.

**Q3 — Is an authored set canonical-and-shared, or personal-and-gifted?** (raised by §5, genuinely open — Josh unsure) Two readings pull apart:

- Canonical: one authoritative set per domain, for everyone who declares it. Clean, scales, but makes authoring a public utility and sharpens the "whose set wins?" tension.
- Personal/gifted: my Tom Sawyer list is mine; many can coexist; I share with whom I choose. Deeply social, no "whose set wins" problem — but no single canonical answer when a stranger declares Tom Sawyer, and set quality varies.

A candidate reconciliation (not decided): they coexist, distinguished by who it's for — a personal list is a gift to friends (many exist, quality varies, fine because it's a social object); a widely-played, proven-great list can graduate into the canonical set for strangers. Same authoring act, two lifecycles; personal gifting is the on-ramp, canonicalization is what the best gifts earn. This also rhymes with the deferred coordinated-gifting idea (a list made for a specific person/occasion — bridal shower, reunion). Left open deliberately; it may be that personal-gift is the primary object and canonical is just what the best-loved lists become — but that's not settled. Note the interaction with §6: the "held up across many players" evaluation signal and the "graduates to canonical" lifecycle are the same underlying thing — proven-by-play — so Q1 and Q3 likely share a mechanism.

**Q4 — How deep does the domain tree go, and how does mastery compose up it?** (raised by §6a's four-level chain — Book 3 → series → Rowling → Modern Fantasy) Three sub-questions, all amplified-not-created by depth:

- Who authors structure at each join, and how are disputes resolved? Deeper trees have more structural forks (Harry Potter under "Rowling" or directly under "Modern Fantasy"?). Same evaluator mechanism as Q1, exercised harder.
- Does mastery compose multiplicatively all the way up, or one level only? Book 3 (15% of series) × series (60% of Rowling) × Rowling (8% of genre) ≈ 0.7% to genre mastery — is that a number anyone endorses? Real decision: all-the-way-up multiplication vs. one-level rollup. Implementation note: record parent-per-node (full tree) from day one, defer the composition math — structure is cheap, upward-rollup is the phased part.
- Where is the tree's natural bottom? Go as deep as mastery is meaningful at each level ("Book 3" yes, "Chapter 7" probably no) and stop where it becomes taxonomy for its own sake. The tree has a floor, not infinite descent.

---

## 10. Where this sits / what NOT to do next

- Do not build. Do not write `D-SUPPLY-FINITE-SET-01` (or a successor) yet. Let this direction sit a few days — it's the latest of several refinements in one session, which is the thinking working, and a shift this central to the product's content model deserves to settle before it becomes ratifiable decisions.
- The supply pause stays. This makes automated refill less central; nothing here justifies a paid run.
- The free work continues. The batch-verify cost characterization is unaffected and useful either way (verification survives in this model).
- When ready: the natural successor is a real decision doc built on resolving §9's three open questions, with §1–§8 as its settled frame. The pending marker should be updated to point here. Note that §5 (social authoring) and §6 (the contribution→mastery loop) are the two mechanisms most likely to lead that doc — Q1 (how contributions are judged) and Q3 (canonical vs. gifted) share the "proven-by-play" signal, so they may resolve together.

This note is a snapshot of a direction, not a commitment to it. Its value is that you can now read the whole model at once and find the parts that are still wrong.
