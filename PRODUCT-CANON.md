# Joshing Product Canon

> **Audience:** a product designer joining Joshing.
>
> **Stance:** this is product canon, not a code audit. Implementation details are included only where they materially define the product behavior that a designer must preserve.
>
> **Source baseline:** latest `PRD-D-*` documents, `DECISIONS.md`, and the current app surfaces as of 2026-06-13.

---

## 1. What problem does Joshing solve?

Joshing solves the problem of making knowledge feel **personal, social, and alive** without turning it into school, work, or a performative quiz app.

Most trivia products ask, "Can you answer this?" Joshing asks, "What does this reveal about what you and your people know, love, remember, and are becoming curious about?"

The core problem is not a shortage of questions. It is that knowledge games usually fail at three things:

1. **They are not about me.** Generic trivia treats every player as interchangeable. Joshing draws from declared and demonstrated interests, then builds a knowledge portrait over time.
2. **They are not about my relationships.** Leaderboards and multiplayer modes create pressure, not intimacy. Joshing uses questions as gifts, signals, and conversation starters among people who follow each other.
3. **They do not create durable self-understanding.** A correct answer normally disappears into a score. Joshing turns play into mastery, activity, ceremony, and reflection.

The product promise is therefore:

> **A daily knowledge ritual where five questions help you discover what you know, what your friends are into, and where your curiosity overlaps with real people.**

Joshing is a game, but its differentiator is not points. Its differentiator is **relational knowledge**: the feeling that a question reached you because of who you are, who you know, or who else is wandering the same niche.

---

## 2. What emotional journey should a player experience?

A good Joshing session should feel like a gentle arc from invitation to recognition.

### 1. Arrival: "There is something here for me."

The Home page should not feel like a backlog. It should feel like today's edition: a small, curated set of things worth noticing. The first emotional beat is calm readiness, not urgency.

The player should understand:

- I have today's five.
- Some questions may have come from people.
- The page has a budget; I am not staring at an infinite chore list.

### 2. Play: "I can try without being punished."

The Daily Five is a ritual, not a test. The chat-first play surface should keep focus on one question at a time, with a quiet reveal and no anxiety mechanics like visible countdown pressure.

The player should feel:

- curious, not graded;
- challenged, not shamed;
- willing to guess, because the product is about calibration and discovery.

### 3. Feedback: "That answer meant something."

Correctness matters, but it is not the whole payoff. A result can update mastery, reveal an author's note, explain why a friend sent something, or become a social signal.

The key emotional move is from **answering** to **recognizing context**:

- "I knew that."
- "I did not know that, but now I see why it belongs to my map."
- "Robyn thought of me when sending this."
- "A stranger in this niche exists."

### 4. Social awareness: "My people have intellectual texture."

Friend activity should make other people feel vivid without becoming surveillance. A friend playing geography, film, literature, or a specific niche should read as a lightweight signal of curiosity.

The desired emotion is warmth: "I see what they are into," not obligation: "I must respond to all of this."

### 5. Reflection: "I am becoming someone in this map."

Knowledge and ceremony surfaces should turn many small answers into a portrait. The player should periodically feel that Joshing has noticed something true: a domain they are deepening, a shared ground with someone else, a world that is expanding.

The long-term emotional journey is:

> **From today's question → to a friend's signal → to a pattern in my knowledge → to a clearer sense of my intellectual identity.**

---

## 3. Core product loops

### Loop A — The Daily Knowledge Ritual

1. Player opens Home.
2. Player starts or resumes Today's Five.
3. Player answers five interest-calibrated questions.
4. Answers produce correctness feedback, mastery movement, and summary.
5. The next day resets the ritual.

Design job: make this loop reliable, quiet, and central. It is the heartbeat.

### Loop B — Friend-to-Friend Question Gift

1. A player authors or forwards a question.
2. They send it directly or broadcast it to followers/friends.
3. The recipient sees it in a deliberate human-intent surface, not buried in noise.
4. The recipient answers.
5. The sender/relationship context becomes visible through notes, attribution, activity, or follow-on play.

Design job: preserve the feeling that a question is a gift, not a task or read-receipt message.

### Loop C — Friend Activity Becomes Playable Discovery

1. A friend answers something correctly.
2. That signal can become a playable opportunity for me when appropriate.
3. The product frames it as ambient activity: "what friends are into," not a demand.
4. I can answer inline or let it pass.
5. My own play may then become a signal for others.

Design job: create social texture while avoiding obligation, spam, or surveillance.

### Loop D — Niche-Match Discovery

1. I author a niche question.
2. Someone outside my mutual friend graph answers it correctly.
3. If privacy gates allow it, one or both of us get a low-volume activity item.
4. The activity links to a profile and normal follow mechanics.
5. A rare niche overlap can become a real connection.

Design job: make this feel like serendipity, never a growth funnel. No counters, streaks, or match pressure.

### Loop E — Knowledge Portrait and Ceremony

1. Daily play and authored interactions produce mastery events.
2. Domains and interests accumulate into a knowledge portrait.
3. Periodic ceremony packages reflection into a more meaningful artifact.
4. The player sees progress, overlap, and change over time.
5. That reflection motivates another daily ritual.

Design job: turn correctness into identity without making the product feel like school analytics.

### Loop F — Content Quality Flywheel

1. The system generates or reuses questions from a durable pool.
2. Quality floor, verification, deduplication, and retrieval-grounding protect trust.
3. Authored, curated, daily-generated, forwarded, and house-origin content retain honest provenance.
4. Better content creates more confident play and sharing.

Design job: trust is product behavior. Provenance labels and source distinctions are UX primitives, not backend trivia.

---

## 4. Primary screens and why they exist

### Home (`/`)

Home is the daily edition. It exists to answer: **"What is worth my attention today?"**

It contains the Today's Five hero, a fixed-budget For You edition, direct questions, playable friend activity, texture/social rows, one rotating panel, and the composer. Its job is pacing: one loud daily ritual, then bounded social/product texture. It should never become an infinite log or obligation wall.

### Daily (`/daily`, `/daily/summary`, `/daily/catchup`)

Daily is the focused play ritual. It exists to answer: **"What are my five questions today, and what did they reveal?"**

The play screen is intentionally focused and chrome-light. Summary converts the round into feedback. Catch-up gives missed questions a separate home without making Home carry a retrospective archive.

### Questions / Bank (`/questions`)

Questions is the player's authored-question surface. It exists to answer: **"What questions have I made, saved, or want to send?"**

This is where authorship becomes a product loop. It should make writing feel worthwhile even when the payoff is delayed or niche.

### Feed / For You zones (`/for-you`, Home feed components)

The feed system exists to separate deliberate human intent from ambient activity. Direct sends and broadcasts are not the same as "a friend answered something." Designers should keep those jobs distinct.

### From Friends (`/from-friends`)

From Friends exists to answer: **"What have my friends recently played that I can also play?"**

The current direction is chronological activity, not topic clustering. It should feel like a record of recent friend play with inline opportunities, not a leaderboard or mastery report about other people.

### Activities / Lately (`/activities`)

Lately exists to answer: **"What notable things happened?"**

It is a notification and correctness-moment digest. It is not the presence surface, not the main feed, and not the place to dump every ambient signal. Niche matches can live here precisely because they are rare and meaningful.

### Knowledge (`/knowledge`, `/knowledge/[domain]`)

Knowledge exists to answer: **"What does Joshing think I know and care about?"**

It is the portrait/map surface: declared interests, demonstrated mastery, dismissed/reopened domains, and domain-specific progress. It should make the player feel understood, not measured in a school-like way.

### Friends / Find Friends (`/friends`, `/friends/find`, `/users/[id]`)

Friends exists to answer: **"Who am I connected to, and what do we share?"**

The primitive is directional follow; "friend" means mutual follow when reciprocity matters. Profiles are where shared interests, recent exploration, and follow actions become visible. Discovery through contacts and niche match should remain conceptually separate.

### Profile / Settings (`/users/me`)

Profile exists to answer: **"How do I present myself and control discoverability?"**

Privacy controls are product surfaces. Discoverability by contacts, mutual friends, and niche match each imply a different social contract and must be explained plainly.

### Ceremony (`/ceremony/[id]`)

Ceremony exists to answer: **"What did this period of play mean?"**

It is a reflective artifact, not another feed card. It earns a more immersive, self-contained treatment because it packages identity and progress.

### Games (`/games/[id]`, `/new-game`)

Joshing Games are implemented but creation is deliberately gated/disabled in the current product line. They are invited contexts, not organic discovery contexts. Designers should not use game interactions as niche-match discovery signals unless that decision is reopened.

### Archive / Replay (`/archive`, `/replay`)

Archive and Replay exist in code but are deliberately unlinked. Treat them as deferred or orphaned surfaces, not current navigation pillars.

---

## 5. Product principles

### 1. Questions are gifts, not messages.

A sent question does not create a read receipt, expiry pressure, or sender-owned clock. It may wait in the deck. The recipient's pace is respected.

### 2. The daily ritual is sacred.

Today's Five is the product heartbeat. Do not bury it, fragment it, or let social inventory overwhelm it.

### 3. Provenance must be honest.

Authored, forwarded, daily-generated, house-authored, and curated content must not blur into one another. A non-human source may curate; it must never pretend to be a peer.

### 4. Social signals should create warmth, not obligation.

Friend activity should be ambient, bounded, and playable where useful. It should not become a task queue, surveillance stream, or leaderboard.

### 5. Scarcity is acceptable; fake social density is not.

A niche may be quiet. House/editorial content can seed the well if labeled honestly. Synthetic friends, fake peers, or bot-like social actors are forbidden.

### 6. Specificity beats volume.

The atonal-stranger story matters because it is rare. Joshing should make specific overlaps feel magical, not optimize them into high-frequency growth mechanics.

### 7. Reflection is part of the game.

The knowledge map and ceremony are not secondary analytics. They are the long-term meaning layer that makes daily answers accumulate into identity.

### 8. Home is an edition, not a log.

The home page should have a serving budget. Overflow can exist, but the first page must feel composed.

### 9. Trust is a UX requirement.

Question quality, difficulty calibration, source grounding, and verification materially affect product experience. A player who stops trusting correctness stops trusting the game.

### 10. Privacy gates are promises, not preferences.

If a setting controls whether identity is exposed, design must treat it as a consent boundary. Avoid copy or flows that imply exposure before the user has allowed it.

---

## 6. What is intentionally not part of Joshing?

Joshing is intentionally **not**:

- a generic trivia firehose;
- a school quiz or assessment product;
- a leaderboard-first competition app;
- a streak-pressure habit tracker;
- a messaging app with read receipts;
- a social network optimized around follows, counters, virality, or public performance;
- a dating-style matching product;
- a bot-filled community where synthetic users pretend to be peers;
- a content farm where provenance is hidden;
- a to-do list of unanswered friend obligations;
- an archive-first product where Home becomes a temporal backlog;
- a surveillance feed of everything friends got wrong;
- a place where house/editorial content can accrue social identity or be followed;
- a game where invited private contexts automatically become organic discovery.

These exclusions are not negative space; they are the guardrails that make the product feel intimate and trustworthy.

---

## 7. How every UX decision should be evaluated

Use this checklist for every UX decision:

1. **Does it protect the Daily Five as the heartbeat?**
2. **Does it make the player feel invited rather than obligated?**
3. **Is the provenance of the question honest at the moment it matters?**
4. **Does it preserve the difference between direct human intent, ambient friend activity, and system/editorial curation?**
5. **Does it create warmth without surveillance?**
6. **Does it respect recipient pace — no read receipts, no sender-owned expiry pressure?**
7. **Does it make niche specificity feel valuable without adding volume pressure?**
8. **Does it expose identity only within the promised privacy gates?**
9. **Does it add to the player's knowledge portrait or relationship context, rather than just adding content?**
10. **If the product were quiet today, would this still feel graceful?**
11. **If the product were busy today, would this still feel bounded?**
12. **Would a new player understand why this screen exists in one sentence?**

If the answer to any of the first eight is no, the design likely violates product canon.

---

## 8. What has changed most over the last few months?

### From v11 to the D-line: the product became more explicit about social semantics

The largest shift is not visual. It is conceptual: Joshing moved from a mixed feed/friendship model toward a clearer taxonomy of social signals.

Key changes:

- **Directional follow replaced symmetric friendship as the primitive.** Mutual follow can still mean friend, but follow direction now carries product meaning.
- **Feed and Daily split jobs.** Deliberate sends/broadcasts belong in feed-like surfaces; friend-answer signals now need playable and presence homes rather than polluting one list.
- **Daily +2 was reframed.** Bonus slots are not simply friend answers bolted onto the Daily; the newer direction treats playables as fresh questions drawn from friend territory/activity, preserving the Daily ritual's integrity.
- **Home became a budgeted edition.** The product moved away from logs and temporal archives on Home toward served slices, overflow subpages, and empty-state discipline.
- **From Friends moved toward chronological activity.** The old topic-grouped mastery summary is being replaced by a recent-play activity model that better matches user expectations.
- **Authored-vs-curated provenance hardened.** Forwarding no longer steals authorship; house/editorial content is allowed only as labeled non-human curation.
- **Question quality became product strategy.** Difficulty floor, durable pool, retrieval-grounded generation, deduplication, and verification moved from backend concerns to trust-critical product commitments.
- **Discovery became niche-based and privacy-gated.** Contact discovery remains separate from the new niche-match loop: people can find each other through shared obscure knowledge, but only under explicit gates.
- **Lately clarified its role.** It is a digest of notable activity/correctness moments, not a presence feed and not a bottom-nav destination.

The summary: Joshing has been narrowing from "social trivia app" into **a paced daily knowledge ritual with honest provenance and relational discovery.**

---

## 9. Biggest unresolved product questions

1. **Should the aside amplify a human creator note?** Today the aside and creator note are independent. Product needs to decide whether human-authored questions with a creator note should use the aside to strengthen that same voice.
2. **What is the production default for niche-match discoverability?** The test phase can default on, but the real production privacy posture remains open.
3. **How should thumbs-up affect surface priority?** The signal exists but does not yet have a settled ranking model.
4. **How should house-origin questions be guarded in every render path?** House author shipped, but the remaining invariant is that house content must never fall back to peer-like copy such as "A friend."
5. **What exact shape should From Friends take after the chronological activity shift?** Grouping, held singles, completed-card lifecycle, and persistence need final product tuning.
6. **How should Home pacing be sequenced with visual card tiers?** The budget model is aligned, but it depends on tier rendering to achieve rhythm.
7. **What should happen to Archive and Replay?** They are built but unlinked; product needs to decide whether to revive, keep deferred, or delete.
8. **When, if ever, should Joshing Games creation re-open?** The system exists, but the current product canon treats creation as gated.
9. **How much house/editorial seeding is enough?** House can solve content scarcity, but too much house content could weaken the feeling that Joshing is about real people and personal knowledge.
10. **What is the right empty-state experience for the first 50 users?** The all-empty Home state is a default launch condition, not an edge case; it deserves first-class design attention.

---

## 10. If Joshing had to be explained in five pages

### Page 1 — The Promise

Joshing is a daily knowledge game where five questions a day become a portrait of what you know and a lightweight social fabric around what your people are curious about.

The promise has three parts:

- **Personal:** questions come from your declared and demonstrated interests.
- **Social:** questions can be sent, answered, noticed, and used to discover people.
- **Reflective:** answers accumulate into mastery, activity, and ceremony.

The product should feel intimate, not viral; playful, not academic; paced, not endless.

### Page 2 — The Ritual

The Daily Five is the heartbeat. Home invites you into it. Daily play focuses you on one question at a time. Summary tells you what happened. Catch-up handles missed questions without letting Home become an archive.

Everything else must orbit this ritual. Friend activity, direct sends, authored questions, and ceremony can enrich it, but none should make the daily round feel secondary.

### Page 3 — The Social Model

Joshing's social model is directional follow plus honest provenance.

- A direct send is deliberate human intent.
- A broadcast is a question shared to followers/friends.
- Friend activity is ambient signal and sometimes playable opportunity.
- Niche match is rare stranger discovery through authored questions.
- House/editorial is labeled non-human curation, never a peer.

The design challenge is keeping those meanings separate while making the whole product feel warm.

### Page 4 — The Map and Meaning

The Knowledge surface and Ceremony turn play into identity. Joshing should help a player see:

- what domains they are growing in;
- what they share with friends;
- what niches make them distinctive;
- what changed over the last period of play.

This is why correctness quality matters. If questions are wrong, too easy, too generic, or badly attributed, the portrait becomes untrustworthy.

### Page 5 — The Design Rules

Every designer should remember:

1. Protect the Daily Five.
2. Keep Home budgeted.
3. Treat questions as gifts.
4. Be honest about provenance.
5. Prefer warmth over obligation.
6. Prefer specificity over volume.
7. Never fake a peer.
8. Respect privacy gates.
9. Design empty and quiet states first.
10. Make every surface answer a clear product question.

If a proposed design makes Joshing feel more like a generic feed, quiz app, messaging app, or growth network, it is probably moving away from the canon.
