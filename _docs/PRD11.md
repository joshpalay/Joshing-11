**JOSHING --- PRODUCT REQUIREMENTS DOCUMENT**

**Version 11.1** **May 2026**

*The trivia you wish you were asked.*

**1. Executive Summary**

Joshing is a daily trivia practice built on the things you actually know
--- and the people who know you.

Every day, you get five questions calibrated to your intellectual world.
The questions are factual. They have correct answers. What makes them
*Joshing* questions is that they are drawn from the specific cultural
and intellectual territory you live in: the music you\'ve spent time
with, the books you\'ve read, the history you studied, the films and
ideas that shaped how you see things. \"Who wrote Wozzeck?\" is generic
trivia to most people. To you, it\'s the question you always wished you
had been asked.

The daily five is yours alone --- generated for you, calibrated to a
Knowledge base that grows with you over time. You start by choosing five
areas of focus. Everything beyond those five is unlocked by the people
in your life: every friend who sends you a question, thumbs up a
question they think you\'d love, or writes one with you in mind expands
the world your daily five can be drawn from. Your declared interests are
who you say you are. Your Knowledge base is who you\'ve become ---
shaped by the friends you let in.

Alongside the daily five sits a Feed of questions your friends have
answered. It is where the social life of Joshing lives. It is not a
game and it is not a competition. You see what your friends played, and
how they did. The questions they sent directly to you are pinned at the
top. The rest flows by friendship alone.

Joshing is invitation-only. Every player was brought here by someone who
wanted them here. When you invite a friend, you can pre-seed a few
interests for them --- a small act of curation that says *I know you, I
think you\'d like this*. The invitation itself is a gift.

Every two weeks, Joshing surfaces a reflection: what you\'ve mastered,
what new territory you\'ve discovered, which friends most shaped your
map, who you\'re most aligned with. It is the only moment Joshing speaks
back to you about who you are becoming. The rest is daily, quiet,
personal.

Joshing is a web-based product. There is nothing to download. The
invitation arrives as a message from a friend, not from a product. It
works on any phone, any browser, any device. US-only at launch.

**2. Problem Statement & Opportunity**

**2.1 The problem**

General-knowledge trivia rewards breadth at the expense of depth. The
questions are written for the average player, which means they are
written for no one in particular. People who have spent ten years inside
Mahler symphonies or twenty years inside Civil War history are asked the
same Marvel-and-state-capitals questions as everyone else. The depth
they actually have is invisible to the format.

The result: trivia, as a category, is a thin entertainment. It tests
recall of widely-shared facts. It does not engage what people actually
know.

There is a second problem. The trivia experiences that *do* try to be
more personal --- house games, friend-group quizzes, party questions ---
require someone to do the work of writing questions. In testing of an
earlier version of Joshing (v10.25), this was the single most-rejected
mechanic. People liked answering hyper-specific questions. They liked
seeing the connections between what they knew and what their friends
knew. But almost no one wanted to write questions for others. The
work-to-payoff ratio was wrong.

**2.2 The opportunity**

Two changes make a different product possible:

1.  **LLM-generated questions, calibrated to a personal Knowledge
    base.** A model can now produce a hyper-specific, factually-grounded
    question about Late Tchaikovsky or Italian Renaissance painting that
    would have required a human author in 2022. The depth that was
    previously invisible can now be reached by an algorithm --- *if* the
    algorithm knows what to aim at.

2.  **A social layer built on curation, not authorship.** The gesture
    that scales is not \"write a question for your friend\" --- it is
    \"thumb up a question you loved\" and \"send this one to Maya.\"
    These are low-friction, take-no-time gestures that people actually
    do. They produce a stream of human-curated content without asking
    humans to do the work of writing it.

Joshing v11.0 is built around these two changes. The daily ritual is
solo and machine-generated. The social layer is ambient and
curation-based. They live side-by-side, do different jobs, and reinforce
each other.

**2.3 Comps**

  ------------------------------------------------------------------------
  **Product**   **What we share**                  **What we don\'t**
  ------------- ---------------------------------- -----------------------
  Wordle /      Daily ritual, bounded session, no  Generic puzzle vs.
  Connections   infinite scroll, shareable result  personal trivia

  Instagram     \"Thought of you when I saw this\" Visual content vs.
  (DMs)         gesture, ambient feed of           trivia; broad vs.
                friend-curated content             invitation-only

  Letterboxd /  Persistent intellectual portrait,  Tracks consumption vs.
  Goodreads     friend overlap, taste as identity  tests knowledge

  BeReal        Invitation-only social graph,      Performative photo vs.
                daily prompt, intimacy through     quiet practice
                small group                        

  Marco Polo    SMS-based invite, bounded social   Voice/video vs. text
                network, asynchronous              trivia
  ------------------------------------------------------------------------

What\'s distinctive about Joshing: it is the only product where your
**intellectual** life is the surface area of social connection, and
where the daily ritual is **calibrated** to who you specifically are.

**3. Product Vision**

**3.1 Short-term (v11.0 launch)**

A working solo daily ritual + a friend-curated Feed + a clean
send-to-friend gesture, on an invitation-only graph. Two surfaces, both
quiet, both useful. A product that \~50 invitation-graph-connected
players use daily without prompting.

**3.2 Medium-term (6--12 months)**

The friend graph becomes the primary engine of intellectual expansion.
Players\' Knowledge bases visibly grow through their relationships.
Biweekly ceremonies become a moment people screenshot and share.
Friend-of-friend introductions become the dominant growth mechanic. The
product begins to feel like a personal map of intellectual life shaped
by the people in it.

**3.3 Long-term (1--3 years)**

Joshing becomes the canonical place for intellectual identity online ---
a quiet alternative to taste-displaying social products. The Knowledge
Portrait is something people cite about themselves: \"Here\'s mine.\"
Friend graphs span the social experiences in someone\'s life --- book
club friends, college friends, music-nerd friends --- each producing
different kinds of growth in different parts of the Knowledge base. The
product is thin, daily, and persistent across years.

**3.4 What Joshing will not become**

- A leaderboard product

- A streak-driven engagement product

- An algorithmic feed of strangers\' content

- A general-knowledge trivia product

- A social product where intellectual depth is performed rather than
  practiced

These are explicit non-goals. Decisions in v11.0 should be checked
against them.

**4. Target Audience**

**4.1 Primary**

**Intellectually-engaged adults (25--55) with at least one area of deep
knowledge.** The kind of person who has read all of Joyce, or who can
name every Tchaikovsky symphony, or who has opinions about the Hungarian
uprising of 1956. Often (but not always) college-educated, often (but
not always) in knowledge-work professions. The defining trait is not
credentials --- it is that they have *territory* they care about and
have spent time in.

**4.2 Secondary**

**The intellectually-curious-but-broad.** People without a single deep
specialty but with a wide range of moderate interests. They get value
from the Daily Five but their growth happens primarily through the Feed
--- they find new territory through what their deeper-specialist friends
share with them.

**4.3 Use cases**

- The morning ritual (with coffee, before email)

- The transit moment (on a commute, in a waiting room)

- The bedtime wind-down

- The \"thought of you\" beat (mid-day, sending a question to a specific
  friend)

- The biweekly reflection (when the ceremony arrives)

**4.4 Not the audience**

- Pub-trivia teams looking for general-knowledge content

- Casual mobile gamers looking for time-killer mechanics

- People who want to compete on speed or score

- People who want to perform intellectual identity for strangers

**5. MVP Scope and Phasing**

**5.1 v11.0 Launch Scope**

**Account & Social**

- SMS authentication (US phone numbers only)

- Invitation-only signup (invite via SMS, accept via link)

- In-app friend requests by phone number (mutual accept)

- Unilateral unfriend (silent, no notification)

- Friend profiles (/users/\[slug\]) with Knowledge Portrait + declared
  interests + authored questions

**Daily Five**

- LLM-generated, calibrated to player\'s Knowledge base

- 5 questions/day, noon EST delivery via SMS link

- 24-hour session window, 7-day catch-up grace

- No in-session timer

- Configurable: Difficulty
  (Normal/Moderate/Challenging/Ridiculous/Adaptive --- Adaptive default
  starts at Normal), Domains (Random/Custom)

- Chat thread interface for answering

**Feed**

- Bounded reverse-chronological stream (recommended cap: 25 items)

- Two sources: direct-sent (pinned), friend answered (reverse-
  chronological)

- Pre-answer actions: Answer, Skip, Dismiss, Not my focus

- Post-answer actions: Thumbs-up, Thumbs-down, React

- Once-correctly-answered items do not reappear

**Send-to-Friend**

- Floating \"Write a question\" button on home (writes to bank by
  default; optional toggles for Feed share and direct send)

- Send-to-friend action available from any question surface

- Maximum 5 sends per recipient per day

**Knowledge Base**

- Up to 5 declared interests (hard cap, swappable anytime, no cooldown)

- Hybrid onboarding (warm-up Qs → LLM proposes → player picks 5)

- Pre-seeded interests in invitations (optional, 1--3)

- Knowledge base expansion via friend-mediated correct answers
  (1-question floor)

- Knowledge page: implemented circles-by-category model (per current
  design)

- Domain merge/split runs at end of biweekly ceremony cycle

**Biweekly Ceremony**

- Per-player rolling 14-day cadence, anchored to signup date

- 5-beat cinematic flow (Mastered, Discovered, Shaped Your Map, Closest
  Alignment, What You Gave)

- Closes with shareable card (mastery momentum format)

- 7-day in-app availability post-fire, then archived

**Mastery & Points**

- Tier system (Establishing → Familiar → Solid → Mastery) preserved from
  v10.25 §8.32

- Points earned from answering Daily Five and Feed questions (full
  weight) and catch-up (0.25x)

- Creator points earned when friends correctly answer questions you
  wrote

- Mastery tier requires 20% creator points (v10.25 rule preserved)

**Reactions**

- Thumbs-up only (stars killed)

- Reactions on Feed and friend-sent questions per v10.25 §8.10b

- Thumbs-up is the Feed-curation gesture --- endorsing a question makes
  it eligible for the Feeds of your friends

**5.2 Out of v11.0 Scope (deferred or killed)**

**Killed entirely** (not coming back):

- Group games and the three setups (know_me, know_me_plus, open)

- Group seasons, group joining flows, group archives

- Game ending two-act ceremony, Game Summary, Creator\'s Summary

- Public Daily Game, Public Infinite Run

- Post-game similarity sharing

- Star voting and the daily star budget

- Expert challenges (was already deferred in v10.25)

- AI Practice Mode (the Daily Five is now AI practice)

- Public question pool

**Deferred to post-launch:**

- Friend-of-friend introductions (Path 3 of friendship formation)

- Joshing Plus feature set (TBD)

- iOS/Android native apps (web-only at launch)

- International expansion beyond US

**5.3 Phasing within v11.0**

There are no internal phases within v11.0. The product launches as a
single coherent experience. Subsequent versions (v11.1, v11.2...) may
layer in deferred items, but launch is launch.

**6. User Stories**

**6.1 New player onboarding**

**Maya** receives an SMS from her friend Greg: *\"I think you\'d like
this --- try it tonight.\"* She taps the link. Joshing asks for her
phone, sends an OTP, she\'s in. Greg has pre-seeded three interests for
her: Sondheim Musicals, Modernist Poetry, Italian Cinema. She accepts
two, edits one. Next, Joshing asks when she was born and where she grew
up --- she enters 1981 and suburban New Jersey. Then two warm-up
questions: a book she\'s gone deep on, and a topic she could talk about
for an hour. Joshing combines both signals and proposes thirteen
candidate interests. She picks two more --- Late-Period Bowie and
19th-Century English Novels --- locking her five. She receives a
confirmation: *\"Tomorrow at noon, your first five questions arrive.\"*

**6.2 The daily ritual**

**Greg** gets an SMS at 12:00 EST: *\"Your five for today.\"* He taps in
during a quiet moment after lunch. Five questions appear in a
chat-thread interface. He answers four, gets three right, skips the
fifth. The session closes with a quiet summary: *\"3 of 4. You moved
closer to Familiar in Late Tchaikovsky.\"* He exits. Total time: 4
minutes.

**6.3 The Feed moment**

**Maya**, later that evening, opens Joshing again and taps the Feed.
There are 8 items. The top is pinned: *\"Greg sent this to you --- about
Sondheim.\"* She answers it --- gets it right. Below, *\"Robyn got this
right --- W.H. Auden.\"* She skips. *\"Robyn couldn\'t get this ---
Weimar Cinema.\"* She answers it and gets it wrong; the card updates in
place with both their results side by side. She dismisses one more,
leaves the rest for tomorrow. On the way out she taps thumbs-up on the
Sondheim question --- it was a great question, and her signal will push
it higher in friends\' Feeds. She does not need to do anything to share
the questions she answered; those propagated to her friends\' Feeds the
moment she answered them.

**6.4 The send-to-friend gesture**

**Greg** is reading something online about Stephen Sondheim\'s working
method. He thinks of Maya. He opens Joshing, taps the floating \"Write a
question\" button, writes a question about Sondheim\'s notebooks, taps
\"Send to Maya.\" Joshing confirms: *\"Sent. Maya will see it in her
Feed.\"* Total time: 90 seconds. Maya gets an SMS: *\"Greg sent you a
question.\"*

**6.5 Knowledge base growth via Feed**

Over three weeks, **Maya** answers 11 questions in the Feed across
domains she didn\'t declare: Auden, Coltrane, Italian Renaissance
Painting. Each correctly-answered domain is silently added to her
Knowledge base. Her next Daily Five (when set to Random) starts drawing
from these new domains. Her intellectual world has widened --- through
the people in her life --- without her ever being asked to declare
anything new.

**6.6 The biweekly ceremony**

Two weeks into using Joshing, **Greg** gets an SMS Sunday morning:
*\"Two weeks of Joshing. Here\'s what you\'ve been up to.\"* He taps in.
Five cinematic beats, \~45 seconds total: *You moved from Familiar to
Solid in James Joyce\'s Ulysses. You discovered new ground in
Late-Period Bowie and Italian Renaissance Painting. Maya\'s Feed gave
you 7 questions you got right --- she\'s been part of your last two
weeks. You and Maya are most aligned in Modernist Literature. 4 of your
questions were answered by friends.* The ceremony ends with a shareable
card. He saves it.

**6.7 The friend profile visit**

**Greg** taps Maya\'s name in his Feed. Her profile loads. He sees her
five declared interests, her Knowledge Portrait (the circles-by-category
map), with shared territory highlighted. He sees she\'s been deep in
Sondheim recently. He taps \"Send a question\" and writes one. The full
loop, in under two minutes.

**6.8 The unilateral unfriend**

**Maya** decides she doesn\'t want **Charles** in her Joshing world
anymore. From his profile, she taps \"Remove friend.\" Charles
disappears from her Feed and friend list immediately. Charles receives
no notification. From Charles\' side, Maya simply no longer appears in
his Feed sources or in his friend list. The disconnect is silent on both
sides.

**7. Authentication & Onboarding**

**7.1 SMS Authentication**

Authentication is via US mobile phone number + SMS one-time code. There
are no passwords, no email, no third-party sign-on. Phone number is the
unique account identifier.

**Flow:**

1.  User arrives via invitation link (or, post-launch, a public landing
    page that requires an invite code)

2.  Enters phone number

3.  Receives 6-digit OTP via SMS, enters to verify

4.  Account created or signed in

**Constraints:**

- US numbers only at launch (+1 prefix enforced)

- One account per phone number

- OTP expires after 10 minutes

- Rate-limited OTP requests (max 3 per phone per hour)

**7.2 Invitation Flow**

Joshing is invitation-only. There are two paths to a new account:

**Path 1 --- Direct invitation from a friend.**

1.  Existing player taps \"Invite a friend\" from their home screen

2.  Enters recipient phone number + display name

3.  *(Optional)* Pre-seeds 1--3 interest suggestions for the recipient

4.  Composes (or accepts default) personal SMS message

5.  Joshing sends SMS from the inviter\'s phone (via system handoff to
    the user\'s native messaging) --- not from a Joshing number. The
    invitation arrives looking like a personal text from a friend, not
    from a product.

6.  Recipient taps the link, lands on signup, completes auth, optionally
    accepts pre-seeded interests, then proceeds to onboarding (§7.3)

7.  On signup completion, inviter and recipient are automatically
    friends

**Path 2 --- In-app friend request (both already on Joshing).**

1.  Existing player taps \"Add a friend\" from home

2.  Enters target\'s phone number

3.  If the number matches an existing account, an in-app friend request
    is sent

4.  Recipient sees the request in their notifications/Feed top

5.  Recipient accepts or ignores; on accept, both are friends

**7.3 Onboarding (Hybrid Interest Declaration)**

After authentication, a new player goes through a four-step interest
declaration flow before reaching the home screen.

**Step 1 --- Pre-seeded interests (if applicable).**

If the inviter pre-seeded 1--3 interests, these are shown first:

*Greg invited you to Joshing. He thought you\'d like questions about:*

- Late Tchaikovsky

- Weimar Cinema

- Sondheim Musicals

*\[Accept all\] \[Pick which to keep\] \[Skip and start fresh\]*

Accepted pre-seeded interests count toward the 5-interest cap. If no
pre-seeded interests, proceed directly to Step 2.

**Step 2 --- Cultural anchor: birth year + where you grew up.**

Two fields, presented plainly:

*When were you born?* \[Year picker\]

*Where did you grow up?* \[Country selector; if US, state/region
selector appears\]

These two facts are passed to the LLM, which generates a first pass of
hyper-specific culturally-anchored candidate interests. Examples:

- Born 1979, suburban Michigan → candidates: Saturday Morning Cartoons
  of the 1980s, He-Man and the Masters of the Universe, Animaniacs,
  Early MTV (1981--1987), Top 40 Radio of the Late 1980s

- Born 1968, London → candidates: British New Wave Cinema, Post-Punk UK
  Music, Thatcher-Era British Television, 1970s BBC Drama

- Born 1985, São Paulo → candidates reflect Brazilian rather than
  American cultural touchstones

Geography determines cultural context. The LLM must use both year and
country/region to generate meaningful candidates. If geography produces
insufficient signal, the LLM falls back to the warm-up answers alone.

**Step 3 --- Warm-up questions (trimmed to 2--3).**

Free-text questions to capture intellectual territory the cultural
anchor misses:

1.  *\"A book, composer, or filmmaker you\'ve gone deep on?\"*
    (required)

2.  *\"A topic you could talk about for an hour without preparation?\"*
    (required)

3.  *\"Anything else --- a period of history, a sport, a field you
    studied?\"* (optional)

The LLM combines both signals (cultural anchor + warm-up answers) to
produce 10--14 candidate interests at hyper-specific granularity.

**Step 4 --- Pick five.**

*Here are some areas that might fit. Pick up to 5.*

\[Saturday Morning Cartoons, 1980s\] \[He-Man and the Masters of the
Universe\] \[19th-Century English Novels\] \[Italian Renaissance
Painting\] \[Sondheim\'s Late Period\] \[Werner Herzog Documentaries\]
\[The Wire\] \[The Federalist Papers\]

Player can:

- Tap to select, edit any candidate in free text, reject all and write
  their own, mix freely

**Lock and confirm.** *\"Tomorrow at noon, your first Daily Five
arrives. You\'ll receive an SMS.\"*

**7.4 First Daily Five Messaging**

The first Daily Five session includes a one-time orientation panel
before the questions begin:

*Your difficulty is set to Adaptive. It starts at Normal and learns from
you --- right answers will make tomorrow harder, wrong answers will ease
it back. You can change it anytime from settings.*

This appears once, dismissible, and explains the calibration model so
the player understands why difficulty shifts over time.

**7.5 Returning Player Authentication**

Subsequent sign-ins use the same phone-number-plus-OTP flow. Sessions
persist via secure cookies; OTP is required only on new devices or after
30 days of inactivity.

**7.6 Account Deletion**

A player can delete their account from Account → Delete. On delete:

- The player\'s profile becomes inaccessible to all friends

- Questions they wrote remain attributed to \"\[Deleted\]\" in friends\'
  archives

- Their thumbs-up and sent-questions records are retained (as data) but
  their identity is anonymized

- All declared interests, Knowledge base data, and personal performance
  data are permanently deleted within 30 days

- Friends are not notified

**End of Chunk 1.**

React to anything in Sections 1--7 before I move to Chunk 2 (Section 8
--- the bulk of the spec). Things worth checking specifically:

- **§1 Executive Summary** --- does this read like the product you\'re
  building?

- **§2.2** --- the \"two changes\" framing (LLM + curation-based social)
  --- does that capture the why?

- **§4.4** Not the audience --- anything to add or remove?

- **§5.1** Launch scope --- anything missing or anything that snuck in
  that shouldn\'t be there?

- **§6** User stories --- these are doing real work setting expectations
  for engineering. Push back if any feel off.

- **§7.3** Onboarding warm-up questions --- these specific 4--6
  questions are placeholder-quality. We can tune them, but the structure
  is what matters.

- **§7.6** Account deletion --- invented this on the fly, may need
  legal/privacy review.

Producing **Chunk 2 of 3**: Section 8 --- the feature specifications.
This is the bulk of the document.

**8. Feature Specifications**

**8.1 The Daily Five**

**8.1.1 Concept**

The Daily Five is the core ritual of Joshing. Every day at noon EST,
each player receives a daily SMS with a link to that day\'s five
questions. The questions are LLM-generated, calibrated to the player\'s
Knowledge base and chosen difficulty. The session has a 24-hour window;
unanswered questions catch up for 7 days, then archive.

There is no in-session timer. The player can answer all five in one
sitting or spread them across the 24-hour window. Each question, once
opened, must be answered before the next can be revealed (sequential
reveal).

**8.1.2 Source --- LLM Only**

Daily Five questions are LLM-generated. They are calibrated to the
player\'s Knowledge base, chosen difficulty, and selected domains. **No
friend-written, friend-thumbed, or community questions appear in the
Daily Five.** Friend-curated content lives exclusively in the Feed
(§8.2).

This separation is intentional. The Daily Five is **practice** --- a
private, calibrated daily ritual. The Feed is **discovery** --- a
social, ambient stream. Each surface does one job.

**8.1.3 Configuration Controls**

The Daily Five is configurable from the Daily Five page. Three controls:

  -----------------------------------------------------------------------
  **Control**           **Options**                       **Default**
  --------------------- --------------------------------- ---------------
  **Difficulty**        Normal / Moderate / Challenging / Adaptive
                        Ridiculous / Adaptive             (starts at
                                                          Normal)

  **Domains**           Random (across full Knowledge     Random
                        base) / Custom (pick specific)    

  **Domain view**       By Category / By Mastery          By Category
  *(when Custom                                           
  selected)*                                              
  -----------------------------------------------------------------------

When **Custom** is selected, the player picks any subset of domains from
their Knowledge base. The \"By Mastery\" view sorts domains by tier
proximity, surfacing domains where a tier crossing is near.

Configuration changes take effect for the next Daily Five generation
(typically the next noon EST).

**8.1.4 Knowledge Base Calibration**

The LLM generates questions by drawing from the player\'s Knowledge base
--- the union of:

1.  **Declared interests** (up to 5, set by the player; eligible
    immediately upon declaration)

2.  **Demonstrated domains** (accrued via friend-mediated questions;
    eligible after 1 correct answer)

A new player\'s Knowledge base contains only their declared 5. As they
engage with the Feed and friend-sent questions, their Knowledge base
grows, and the Daily Five draws from a wider set of domains over time.

The LLM does not invent domains. If the player has 5 declared interests
and no demonstrated domains, the Daily Five draws only from those 5.
**Knowledge base expansion is exclusively friend-mediated** (§8.4) ---
never algorithmic, never spontaneous.

**8.1.5 Difficulty Calibration**

Difficulty is calibrated by empirical correct rate per domain. The LLM
prompt for Daily Five generation includes:

- The player\'s recent correct rate in the chosen domain(s)

- The player\'s chosen difficulty setting

- Target correct rate per difficulty:

  -----------------------------------
  **Difficulty**   **Target Correct
                   Rate**
  ---------------- ------------------
  Normal           \~70%

  Moderate         \~50%

  Challenging      \~30%

  Ridiculous       \~15%

  Adaptive         Self-calibrating
                   to \~60%
  -----------------------------------

**Player feedback from v10.25 testing indicated questions felt \"really
REALLY hard\" even on Normal.** The v11.0 implementation must address
this in the generation prompt. Specifically:

- Normal-tier questions should test material that a
  *moderately-engaged-with-the-domain* player would know --- not the
  deep cuts

- The LLM prompt must include explicit instruction to avoid
  trivia-of-trivia (e.g., \"what year was X recorded\" when \"what was
  X\" is more meaningful)

- After each Daily Five, a quiet *\"Was today\'s difficulty about
  right?\"* prompt collects calibration data (optional, dismissible)

**Adaptive** is the recommended default for new players. It begins at
Normal and adjusts after each session based on the player\'s correct
rate, targeting \~60% correctness.

**8.1.6 When the LLM Cannot Generate**

If the LLM fails to generate a question for a chosen domain
(insufficient territory, too-narrow scope, repeat-collision with recent
questions), the player is notified at configuration time:

*We couldn\'t generate questions for \[Domain\] today. Pick another or
use Random.*

The Daily Five is never silently degraded. If Random is selected and the
LLM fails on a domain, it falls through to the next domain in the
player\'s Knowledge base. If all domains fail, the player is notified at
noon: *\"Today\'s Daily Five is taking longer than usual. We\'ll try
again shortly.\"* --- and the engine retries.

**8.1.7 Session Mechanics**

**SMS notification at 12:00 EST:**

*Your five for today.* \[link\]

**Session structure:**

- Sequential reveal: question N+1 only appears after question N is
  answered

- Each question opens the chat-thread interface (§8.1.8)

- After all 5 are answered, the session-end summary appears (§8.1.10)

- A player can pause and return; their place is preserved

- The 24-hour window closes at 11:59 EST the following day

**Catch-up:**

- Unanswered questions remain accessible for 7 days post-session

- Catch-up answers count toward mastery at 0.25x weight

- After 7 days, unanswered questions move to archive (un-answerable)

**8.1.8 The Chat-Thread Interface**

Each question is presented in a chat-thread interface (per v10.25 §8.8):

- The question appears as a message bubble

- Player types their answer in a text input

- LLM grades the answer (correct / partial / incorrect) per §9

- Result message appears with brief explainer

- Player can tap \"Next question →\" to proceed

For Daily Five questions, the question attribution shows: *\"From
Joshing\"* (no specific author). For Feed questions answered through
this interface, the attribution shows the friend\'s name (per §8.2).

The chat-thread interface preserves all v10.25 mechanics including:

- Inline reactions on the answer screen (per §8.1.11)

- Copy-to-share affordances on the result

- The breadcrumb system for partial answers (per v10.25 §8.8a,
  simplified --- no \"you both know this\" copy)

- After grading, a per-answer quip appears below the result bubble
  (§8.1.14)

**8.1.9 Answer Grading**

Grading is performed by the LLM with a deterministic answer key check
first. The flow:

1.  Player submits answer

2.  System checks against the question\'s correct_answer field with
    normalization (case, punctuation, common variants)

3.  If exact or normalized match: graded **correct**

4.  If no match: LLM evaluates the answer for semantic correctness

5.  LLM may grade as **correct**, **partially correct** (50% credit), or
    **incorrect**

6.  Result appears with a brief explainer (1--2 sentences)

Partial credit is conservative. The bar for \"correct\" is correctness,
not generosity.

**8.1.10 End-of-Session Summary**

After all 5 questions are answered, a summary screen appears:

*3 of 5.*

*You moved closer to Familiar in / Late Tchaikovsky.* *You held steady
in / James Joyce\'s Ulysses.* *\[Optional close line, adaptive per
§8.1.13\]*

\[Share today\] \[Back to home\]

The summary is short, interpretive, and quiet. It avoids:

- Streak callouts

- Comparison to other players

- Score totals beyond \"X of 5\"

- Urgency or call-to-action language

**8.1.11 Reactions on Daily Five Questions**

After answering a Daily Five question, the player can apply a single
thumbs-up gesture. Thumbs-up on a Daily Five question:

1.  Marks the question as excellent

2.  Contributes to its surface priority in friends\' Feeds --- heavily
    thumbed questions surface earlier in friends\' Feeds, all else equal

The question enters friends\' Feeds automatically when answered (unless
the player thumbs it down). Thumbs-up does not control propagation ---
it is a quality signal only.

There is no daily limit on thumbs-up.

**8.1.12 Mastery & Points**

Daily Five answers count at full weight (1.0x) toward mastery, per
§8.10. Catch-up answers count at 0.25x weight (per §8.1.7).

Daily Five answers cannot earn creator points (the player is not the
author). Creator points come exclusively from friends correctly
answering questions the player wrote (per §8.10.4).

**8.1.13 Session Close Messaging**

Two layers appear at session close:

**Layer 1 --- Score line** (unchanged):

  -------------------------------------
  **Performance**   **Close copy**
  ----------------- -------------------
  5/5               *Untouched.*

  4/5               *Strong.*

  3/5               *Solid.*

  2/5               *Working ground.*

  1/5               *Tomorrow\'s
                    another five.*

  0/5               *Tomorrow\'s
                    another five.*
  -------------------------------------

**Layer 2 --- Interpretive line** (one line, highest-priority match
only; omitted if nothing qualifies):

1.  Tier crossing → *\"You moved to Familiar in Late Tchaikovsky.\"*

2.  First correct in a new demonstrated domain → *\"New ground:
    \[Domain\] is yours now.\"*

3.  5/5 → *\"Clean sweep.\"*

4.  0/5 → *\"Every one of them. Tomorrow.\"*

5.  3+ correct in a row → *\"Three in a row at one point.\"*

6.  All wrong in a single domain → *\"\[Domain\] is worth a deeper
    look.\"*

7.  Otherwise → omit

The interpretive line appears below the score line with a 300ms delay
--- after, not simultaneously.

**8.1.14 Per-Answer Commentary**

After each answer is graded, a single quip appears below the result
bubble in small, muted text. It feels like an aside, not a headline.
Design constraint: **8 words maximum per quip. No exceptions.**

Quips are contextual --- they vary by correctness, surface, and whether
a friend\'s result is known.

**Daily Five --- correct (solo):**
- *\"That\'s your ground.\"*
- *\"Knew it.\"*
- *\"Of course you did.\"*
- *\"Solid.\"*
- *\"There it is.\"*

**Daily Five --- wrong (solo):**
- *\"Now you know.\"*
- *\"Close. It\'ll come.\"*
- *\"Good question.\"*
- *\"That one\'s yours now.\"*
- *\"Tomorrow\'s version of you will know.\"* (use sparingly)

**Feed --- both correct:**
- *\"Same wavelength.\"*
- *\"You both had it.\"*
- *\"Common ground.\"*

**Feed --- you correct, friend wrong:**
- *\"You had it. \[Name\] didn\'t.\"*
- *\"You carried that one.\"*

**Feed --- you wrong, friend correct:**
- *\"\[Name\] had it. You\'ll get there.\"*
- *\"\[Name\]\'s ground. Now it\'s yours too.\"*

**Feed --- both wrong:**
- *\"Neither of you. Good question.\"*
- *\"That one got you both.\"*
- *\"Tough one.\"*

Quips are selected server-side at grade time and stored on the answer
record. This ensures consistency if the player refreshes or returns to a
session mid-way. Do not randomize purely client-side.

**8.2 The Feed**

**8.2.1 Concept**

The Feed is a bounded, living stream of questions your friends have
answered. It is where the social life of Joshing lives. The Feed is
**not** a game and is **not** required --- players who never open it can
still get full value from the Daily Five. But for players who engage,
the Feed is the mechanism by which their Knowledge base expands and
their relationships with friends become legible.

The Feed is organized around friendship, not endorsement. A question
enters your Feed because a friend played it --- not because they curated
it for you. The signal is presence, not curation. You see what they
answered. You see how they did.

**8.2.2 Where It Lives**

The Feed is a top-level nav destination: **Home → Feed → Knowledge →
Account.**

The Home screen surfaces a small Feed indicator: *\"3 new in your
Feed.\"* No badges, no red dots, no urgency. Just a quiet count.

**8.2.3 Feed Item Sources**

A question enters a player\'s Feed when a friend answers it --- correct
or wrong --- in any context (Daily Five, Personal Round, or from their
own Feed).

  -----------------------------------------------------------------------
  **Source**       **Trigger**                             **Priority**
  ---------------- --------------------------------------- --------------
  **Direct send**  A friend uses Send-to-Friend (§8.3)     **Pinned**
                   targeting this player                   above all
                                                           others

  **Friend         A friend answered this question,        Reverse-
  answered**       correct or wrong, in any session        chronological
  -----------------------------------------------------------------------

**Two filters block a question from entering the Feed:**

1.  **Thumbs-down by the friend** --- if the friend who answered the
    question thumbed it down, the question does not propagate to
    anyone\'s Feed. Thumbs-down is a quality gate, not a personal
    preference signal.

2.  **\"Not my focus\" by the recipient** --- if the recipient has
    marked the question\'s domain as \"not my focus,\" questions in that
    domain are filtered out regardless of which friend answered them.
    This is a permanent, domain-level preference, reversible from the
    Knowledge page.

**What does NOT filter the Feed:** whether the friend got the question
right or wrong. Both flow. The result is visible on the Feed item.

When multiple friends have answered the same question, items are
collapsed: *\"Robyn got this right · Greg couldn\'t get it --- Mrs.
Dalloway.\"*

**8.2.4 Feed Item Display**

Each Feed item shows:

- **Question text** (truncated if long, with \"more\" expansion)
- **Result attribution**: *\"Robyn got this right --- Late Romantic
  Piano\"* / *\"Robyn couldn\'t get this --- Mrs. Dalloway\"*
- **Domain pill**
- **Action buttons** (see §8.2.5)

Tap on the friend\'s name → friend\'s profile (§8.6).

**8.2.5 Feed Item Lifecycle**

Each Feed item passes through states. The item is a living card --- it
updates in place as the social moment develops.

**State 1 --- Unanswered**

Actions available:

- **Answer** --- opens the inline chat-thread interface; question grades
  and stores like any other answer; correct answer adds domain to
  Knowledge base (§8.4)
- **Skip** --- moves item to back of Feed; resurfaces if more friends
  answer the same question
- **Dismiss** --- removes this question from Feed permanently; domain
  stays open
- **Not my focus** --- removes all questions in this domain permanently;
  reversible from Knowledge page (§8.4)

**State 2 --- Answered**

After answering, the item updates in place to show:

- Your result: *\"You got it right\"* / *\"You couldn\'t get it\"*
- Friend\'s result for comparison: *\"Robyn couldn\'t get it either\"* /
  *\"Robyn had it\"*

Actions available post-answer:

- **Thumbs-up** --- personal quality signal (\"this was a great
  question\"); feeds into question surface priority scoring across the
  system; does **not** propagate the question to other players\' Feeds
- **Thumbs-down** --- quality signal (\"this wasn\'t a fair question\");
  removes from your Feed and prevents the question from propagating to
  your own friends\' Feeds
- **React** --- send a private reaction to the friend who answered it
  (emoji + optional short text)

**State 3 --- Reacted**

If the friend reacts back to your answer, the item receives a quiet
indicator: *\"Robyn reacted.\"* Tapping reveals the reaction. After
reactions are exchanged, the item settles --- no further updates are
surfaced on the card.

**8.2.6 Feed Mechanics**

- **Bounded.** The Feed displays a maximum of **25 items**. Older items
  roll off (they remain in the Feed item table but are no longer
  surfaced).

- **Reverse-chronological** by the triggering answer event, with
  direct-sent items pinned above the rest.

- **Once correctly answered → gone.** A question the player has
  correctly answered does not reappear in their Feed, even if more
  friends answer it later. Wrong-answered or skipped questions can
  resurface if additional friends answer the same question.

- **No infinite scroll.** The cap is the cap. When the player reaches
  the end, the empty state is *\"You\'re caught up.\"*

**8.2.7 Mastery Credit**

Feed answers count at full weight (1.0x) toward mastery --- they are as
real as Daily Five answers.

Correctly answering a Feed question in a domain not currently in the
player\'s Knowledge base silently adds that domain to the Knowledge page
(§8.4.5). This is the primary mechanism by which the Knowledge base
grows beyond the player\'s declared 5.

**8.2.8 Reactions**

After answering a Feed question, the player can send a private reaction
to the friend who answered it (emoji + optional short text, per v10.25
§8.10b). This reaction is private to the pair.

When the friend sees in their Activity tab that the player answered
their question, they can react back. Both directions are supported.

Reactions are not public, not aggregated, and not displayed to anyone
outside the pair.

**8.2.9 Activity Tab**

The Activity tab is the reverse-chronological record of social moments
around the player\'s questions. Key events surfaced:

- *\"Josh answered your Mrs. Dalloway question --- got it right.\"*
- *\"Josh answered your Upledger Institute question --- couldn\'t get
  it.\"*
- *\"Greg reacted to your answer.\"*

The Activity tab is where friends see the downstream effect of their
Daily Five sessions --- who picked up their questions, how they did. It
closes the social loop without requiring anyone to send anything
deliberately.

**8.2.10 Thumbs-Up and Thumbs-Down as Quality Signals**

**Thumbs-up** (post-answer only):

- Personal signal that a question was excellent
- Feeds into question surface priority: heavily thumbed questions
  surface earlier in friends\' Feeds, all else equal
- Does NOT propagate the question to new feeds --- propagation is
  handled by friendship alone

**Thumbs-down** (post-answer only):

- Quality signal that a question was unfair, incorrect, or poorly formed
- Removes the question from the player\'s own Feed immediately
- Prevents the question from entering the player\'s own friends\' Feeds
  going forward
- The question\'s author can see aggregate thumbs-down signals on
  questions they wrote (in their archive, \"Written by me\" filter)

**8.2.11 \"Not My Focus\" --- Domain Dismissal**

\"Not my focus\" is a domain-level, permanent dismissal gesture. It
signals: *I don\'t want questions in this domain, from any friend,
ever.*

Behavior:

- Available on any unanswered Feed item, pre-answer
- Applies to the question\'s domain (hyper-specific, per §8.4.6) ---
  e.g., \"Upledger Institute,\" not \"Alternative Medicine\"
- All future questions in that domain are filtered from the Feed
  regardless of source
- **Reversible:** The player can visit the Knowledge page → Dismissed
  Domains → re-open any domain
- Does not affect the Daily Five

**8.2.12 Empty Feed States**

**No friends yet:**

*When your friends play, their questions will show up here.* \[Invite a
friend\]

**Friends but no Feed activity:**

*Quiet today. Check back when your friends have played.*

**Caught up:**

*You\'re caught up. Check back later.*

**All domains dismissed:**

*You\'ve focused your Feed. You can re-open domains from your Knowledge
page.*

**8.3 Send-to-Friend**

**8.3.1 The Gesture**

A player can send any question to any specific friend. The gesture is
the Joshing equivalent of sending someone a song you thought of when you
saw them. It is the highest-intent social gesture in the product.

**8.3.2 Two Entry Points**

**Standalone (write-and-send):**

- A floating \"Write a question\" button on the Home screen opens the
  question creation flow (§8.5)

- At save, the player chooses one or more destinations: Bank (default
  on), Send to a specific friend (opens picker)

**In-context:**

- From any question surface (Daily Five answered, Feed answered,
  archive, friend\'s bank, the player\'s own bank), a \"Send to a friend
  →\" action surfaces the friend picker

- Picker shows all friends, searchable, with most-recent-interaction
  sorted to top

**8.3.3 Recipient Experience**

A direct-sent question arrives in the recipient\'s Feed, **pinned
above** all other Feed items, with attribution: *\"Greg sent this to
you.\"*

If the recipient has SMS notifications enabled for friend activity
(default on, opt-out from settings), they receive:

*Greg sent you a question.*

Recipients can answer, skip, or dismiss like any Feed item. Reactions
can be sent back to the sender (per §8.2.7).

**8.3.4 Creator Points**

The sender earns creator points (per §8.10) when the recipient answers
their question correctly --- regardless of whether the question was
originally written by the sender or by someone else. Provenance is
preserved (see §8.5.4 Add to Bank).

For questions the sender wrote themselves, the creator points are 1.0x.
For questions added to bank from another source and forwarded, the
creator points are reduced (suggested: 0.5x) --- the sender gets credit
for curation, the original author already received credit for
authorship.

**8.3.5 Limits**

To prevent spam, a player can send at most **5 questions per day per
recipient**. If exceeded, the send action is disabled with copy:

*You\'ve sent Greg 5 questions today --- give them a beat.*

There is no daily cap on total sends across all recipients (a power-user
sending 1 question to each of 20 friends is fine; sending 20 to one
friend is not).

**8.3.6 Send Confirmation**

After sending, a confirmation toast appears: *\"Sent. Maya will see it
in her Feed.\"*

The sent question appears in the sender\'s archive under a \"Sent\"
filter (per §8.7).

**8.4 Knowledge Base**

**8.4.1 Definition**

The **Knowledge base** is the union of:

1.  **Declared interests** (player chooses, max 5, eligible for Daily
    Five immediately)

2.  **Demonstrated domains** (accrued via friend-mediated correct
    answers, no cap, eligible for Daily Five after 1 correct answer)

The Knowledge base is the surface that drives Daily Five generation.
Domains in the Knowledge base are the candidates the LLM draws from when
generating questions.

**8.4.2 Declared Interests**

**Hard cap: 5.** A player can swap an interest at any time, but never
has more than 5 declared. There is no cooldown on swaps in v11.0
(revisit if abused).

Declared interests are eligible for Daily Five generation **immediately
upon declaration** --- no question-floor required. They are the
player\'s stated focus and the LLM should be able to generate against
them from day one.

When an interest is swapped out:

- Accumulated mastery in that domain is preserved on the Knowledge page

- The domain moves from \"declared\" to \"demonstrated\"

- It remains eligible for Daily Five generation (since it has
  accumulated correct answers, it meets the demonstrated-domain floor of
  1)

**8.4.3 Demonstrated Domains (Expansion Paths)**

A demonstrated domain is added to the Knowledge base via two paths:

**Path 1 --- Friend-mediated correct answer.**

A domain is added when the player correctly answers a question in that
domain from:

- The Feed (friend answered, propagated automatically)

- A direct send-to-friend message

- A Joshing Game

**LLM-generated Daily Five questions cannot add new domains to the
Knowledge base via this path.** They can only deepen mastery in existing
Knowledge base domains.

**Path 2 --- Authorship.**

A domain is also added to the Knowledge base when the player **writes a
question** in that domain and saves it to their bank.

If you can write a factual question about a domain, you know that
territory. Authorship is self-declaration --- it opens the domain
immediately, at the same 1-question threshold as a correct answer.
Saving to bank is sufficient; the question does not need to be sent or
answered.

Practical effect: a player who wants to open \"1980s Andrew Lloyd Webber
Musicals\" but has no friend active in that domain can write one
question about it. The domain opens, becomes eligible for Daily Five
Random selection, and the player can now accumulate mastery there.

**Combined rule:** A demonstrated domain opens via the *first* of: (a)
player correctly answers a friend-mediated question in that domain, or
(b) player writes and saves a question in that domain.

**Authorship does not bypass hyper-specific categorization** --- the
LLM-assigned domain must meet the same specificity standard as any other
domain.

Friends are the primary mechanism of intellectual expansion through
play; authorship is the self-directed alternative.

**Ceremony impact:** Beat 2 (\"What You Discovered\") uses distinct copy
by source:

- Friend-mediated: *\"You found new ground in \[Domain\]. From a
  question \[Friend\] sent you.\"*

- Authored: *\"You opened \[Domain\]. You wrote the first question
  there.\"*

**8.4.4 The 1-Question Floor**

A demonstrated domain becomes eligible for Daily Five generation after
**1 correct answer** in that domain (or 1 authored question saved to
bank --- see §8.4.3 Path 2). The single trigger event:

- Adds the domain to the Knowledge page (silently, per §8.4.5)

- Makes the domain eligible for Daily Five Random selection

- Counts toward initial mastery in that domain (for correct-answer path)

The floor applies equally to friend-mediated correct answers and to
authored questions.

**8.4.5 Quiet Accrual**

When a friend-mediated question in a new domain is correctly answered,
the domain is added to the Knowledge page **silently**. No notification,
no celebration, no ceremony beat for the discovery itself (the biweekly
ceremony surfaces aggregate discovery --- §8.8 --- but the in-the-moment
accrual is invisible).

The Knowledge page reveals what you didn\'t know you knew.

**8.4.6 Hyper-Specific Categorization**

Domains in the Knowledge base are hyper-specific (per v10.25 §3, §9.1
categorization rules). Examples:

- ✅ \"Late Tchaikovsky\" / \"James Joyce\'s Ulysses\" / \"Sondheim\'s
  Late Period\"

- ❌ \"Music\" / \"Literature\" / \"Theater\"

The LLM-driven categorization (§9) determines the canonical domain when
a question is created. Hyper-specificity is enforced at categorization
time.

**8.4.7 Domain Merge & Split**

To prevent fragmentation (e.g., \"Bach WTC Book 1\" + \"Fugal
Arrangements in WTC\" + \"WTC 2\" all separate when they should be one
\"Bach\'s Well-Tempered Clavier\"), domain merge/split runs at the **end
of each biweekly ceremony cycle**.

The merge process:

1.  LLM evaluates the player\'s full domain list for fragmentation

2.  Proposed merges are computed (e.g., \"These three should be one\")

3.  Proposed splits are computed (e.g., \"This domain has accumulated
    questions across two distinct sub-areas\")

4.  Changes are applied silently before the ceremony surface displays

5.  The biweekly ceremony\'s Beat 1 (\"What You Mastered\") reflects the
    post-merge state

If a merge changes a player\'s tier in a domain (e.g., three
Familiar-tier domains merge into one Solid-tier domain), this surfaces
in Beat 1 as a tier-crossing event.

Splits are conservative --- only triggered when a single domain has
clearly accumulated divergent content.

**8.4.8 Knowledge Page Display**

The Knowledge page uses the **circles-by-category** display (already
implemented per current design). Domains are organized as labeled
category clusters (Classical Music, World History, Literature, Film &
Television, Religion & Mythology, etc.). Each domain is shown as a
circle:

- **Color intensity** represents mastery tier (deeper color = higher
  tier)

- **Size** represents accumulated points within the current tier

- **Position** within the cluster is determined by the existing
  implementation

Tap on a domain → domain detail (recent questions, accumulated
correct/total, current tier, distance to next tier, optional \"Personal
round\" deep-dive trigger per §8.4.9).

**8.4.9 Personal Rounds**

From the Knowledge page, a player can tap any domain to launch a
**Personal Round** --- a focused 5-question session in that single
domain. Personal rounds:

- Use the same LLM generation as the Daily Five, scoped to one domain

- Do not consume the player\'s Daily Five for the day

- Count at full weight (1.0x) toward mastery in that domain

- Have no SMS trigger (player-initiated only)

- Have no cap on frequency

Personal rounds exist for the player who wants to deliberately go deep
in a single area. They are an opt-in power-user surface.

**8.4.10 Adjacent Domain Discovery (Post-Launch)**

Adjacent domain discovery is the ability for Joshing to surface a
related domain after a player engages deeply with an existing one ---
e.g., a player deep in Andrew Lloyd Webber 1980s Musicals might be
offered \"Stephen Sondheim\" or \"French Musical Theatre of the 1980s\"
as a suggested expansion.

This feature is **explicitly deferred to post-launch.** It is noted here
to avoid designing the KB schema in a way that forecloses it, and to
establish the design constraint when it is built: **one suggestion,
dismissible, opt-in only. Never automatic KB expansion.**

The risk to avoid: algorithmic reach that feels like the product
deciding your intellectual world. Adjacent suggestions must feel like a
quiet offer, not a recommendation engine.

Design questions to resolve before building: trigger condition (N
correct answers? tier crossing?), suggestion surface (inline after
session? standalone?), whether dismissed suggestions can resurface,
whether accepted suggestions open the KB automatically or require a
correct answer first.

**8.5 Question Creation**

**8.5.1 The Write Flow**

A player writes a question via:

- The floating \"Write a question\" button on Home

- Or \"Write a question\" from any context (e.g., a friend\'s profile)

The write flow:

1.  Player enters the question text

2.  Player enters the correct answer

3.  *(Optional)* Player adds acceptable answer variants (e.g.,
    \"Mahler\" / \"Gustav Mahler\")

4.  *(Optional)* Player adds a creator note (per v10.25 §8.22) --- short
    context shown if the recipient gets it wrong

5.  LLM auto-categorizes the question into a domain (player can
    override)

6.  LLM suggests an answer if the player wants help with #2 (per v10.25
    §8.2)

7.  Player chooses destinations (§8.5.2)

8.  Save

**8.5.2 Destinations**

At save, the player chooses one or more destinations:

  -------------------------------------------------------------------------
  **Destination**   **Default**       **Effect**
  ----------------- ----------------- -------------------------------------
  **Bank**          ON                Question is saved to the player\'s
                                      question bank

  **Send to a       OFF (opens picker Question is sent directly to a chosen
  friend**          if toggled on)    friend (pinned in their Feed, per
                                      §8.3)
  -------------------------------------------------------------------------

Multiple destinations can be chosen simultaneously. A question can be
banked + sent in a single save.

**8.5.3 The Bank**

The player\'s bank is a private collection of questions they\'ve
authored or imported. From the bank, the player can:

- Send any banked question to a friend

- Edit (text, answer, creator note)

- Delete

Bank size is capped per tier (free vs. Plus --- TBD pending §11 Plus
tier definition).

**8.5.4 Add to Bank (Question Importing)**

From any question surface (Daily Five answered, Feed item, archive), a
player can tap \"Add to bank.\" This imports the question into their
bank with full provenance preserved:

- Original author retained as original_author_id

- Importer recorded as imported_by_user_id

- Send-to-friend or share-to-feed of an imported question credits the
  original author\'s creator points at full weight, and the importer\'s
  creator points at 0.5x (per §8.3.4)

This preserves attribution while enabling curation as a meaningful
gesture.

**8.5.5 LLM Answer Suggestion (preserved from v10.25 §8.2)**

When writing a question, the player can tap \"Suggest answer\" --- the
LLM proposes an answer based on the question text. The player can
accept, edit, or reject. The flow is identical to v10.25; copy and
behavior preserved.

**8.6 Friend Profiles**

**8.6.1 Profile Surface**

Every Joshing player has a profile at /users/\[slug\]. Profiles are
visible **only to confirmed friends** --- never to strangers, never
publicly indexed.

**8.6.2 Profile Contents**

  -----------------------------------------------------------------------
  **Element**     **Display**
  --------------- -------------------------------------------------------
  Display name    Top of profile

  Declared        Prominent list
  interests (5)   

  Knowledge       Circles-by-category display (per §8.4.8), with overlap
  Portrait        markers highlighting domains the visitor also has
                  demonstrated activity in

  Questions       Limited list (most recent or most-thumbed), with
  written         one-tap \"Add to bank\"

  Aggregate       Total questions written, total thumbs received, total
  signal          questions sent --- small text, no ranking

  **Send a        Primary CTA --- opens send picker scoped to questions
  question to     in visitor\'s bank, or write-new
  \[Name\]**      
  -----------------------------------------------------------------------

**8.6.3 What Profiles Never Show**

- Correct rates or session scores

- Streak length

- Point totals or rankings

- Comparison to other friends

- Any data the friend has not implicitly opted into by playing

The profile is an **intellectual portrait**, not a scoreboard. This is a
load-bearing design principle --- violation breaks the product\'s
emotional register.

**8.6.4 Removing a Friend**

From a friend\'s profile, a \"Remove friend\" action is available.
Tapping it:

1.  Confirms (one tap to confirm: *\"Remove \[Name\] from your
    friends?\"*)

2.  On confirm: the friendship is severed immediately

3.  The removed friend disappears from this player\'s Feed sources,
    friend list, and profile views

4.  The removed friend receives **no notification**

5.  From the other side: this player simply no longer appears in their
    Feed sources or friend list

Symmetric, silent, no friction beyond the confirm tap.

**8.7 Archive**

The Archive is a personal record of every question the player has
interacted with. It is organized by source:

  -------------------------------------------------------------------------
  **Filter**   **Contents**
  ------------ ------------------------------------------------------------
  All          Everything below, reverse-chronological

  Daily Five   LLM-generated questions answered in Daily Five sessions

  Feed         Questions answered from the Feed

  Sent to me   Direct-sent questions answered

  Sent by me   Questions this player sent to others (with recipient +
               answer status)

  Written by   Questions this player authored (with full performance: who
  me           answered, who got it right, who reacted)

  Catch-up     Questions answered after the original session window
  -------------------------------------------------------------------------

Each archived question shows: question text, correct answer, the
player\'s submitted answer, correctness, domain, source attribution,
date, and any reactions.

The archive is searchable by domain and by free-text query.

**8.8 Biweekly Ceremony**

**8.8.1 Concept**

The biweekly ceremony is the only moment Joshing speaks back to the
player about who they are becoming. It is the product\'s **emotional
heartbeat**. Every other surface is daily, quiet, and personal --- the
ceremony is cinematic, narrative, and reflective.

It fires every 14 days on a per-player rolling cadence, anchored to the
player\'s account creation date.

**8.8.2 Trigger**

- SMS sent the morning of the ceremony day: *\"Two weeks of Joshing.
  Here\'s what you\'ve been up to.\"* \[link\]

- Ceremony available in-app for 7 days after fire

- After 7 days, archived to Account → Past Reflections (browsable
  indefinitely)

The biweekly ceremony cycle is also the **trigger for domain
merge/split** (§8.4.7), which runs before the ceremony surface displays.

**8.8.3 Cinematic Register**

Inherits the visual language from v10.25 §8.29:

- Full-screen beats

- Ink-on-cream typography

- \~3-second auto-advance with tap-to-skip-forward

- Fade transitions between beats

- Background subtle motion (per existing design system)

The cinematic quality matters --- this is the moment that earns
retention. Treat it as a hero feature, not a recap screen.

**8.8.4 Beat Structure**

Five beats, in order. Beats with no content are silently omitted.

**Beat 1 --- What You Mastered**

Surfaces tier crossings in the past 14 days.

- Copy: *\"You moved from Establishing to Familiar in / Late
  Tchaikovsky.\"*

- Multiple tier crossings: stacked, one per beat-extension

- Mastery-tier crossings get distinct typographic emphasis

- If no tier crossings: *\"You\'re building. \[Top-by-points-earned
  domain\] is closest to its next tier.\"*

**Beat 2 --- What You Discovered**

Surfaces new domains added to the Knowledge base in the past 14 days
(via friend-mediated activity).

- Copy: *\"You found new ground in / \[Domain 1\] · \[Domain 2\] ·
  \[Domain 3\]\"*

- For each: surfaces the friend who introduced the domain --- *\"From a
  question Greg sent you.\"*

- If no new domains: beat omitted

**Beat 3 --- Who Shaped Your Map**

Surfaces top 3 friends ranked by contribution to the player\'s Knowledge
base growth + mastery progress in the past 14 days.

- Copy: *\"Greg sent you 4 questions you got right. Maya\'s Feed gave
  you 7. They\'ve been part of your last two weeks.\"*

- Frames the social graph as a force that materially shapes intellectual
  life

- If fewer than 3 friends contributed: shows however many did

- If zero friends contributed: beat omitted

**Beat 4 --- Your Closest Alignment**

Surfaces the friend with the highest current intellectual alignment
score.

- Copy: *\"You and Maya are most aligned in / Modernist Literature ·
  Sondheim Musicals.\"*

- Tap → friend\'s profile

- Alignment computed per v10.25 §8.14 mechanics, scoped to the friend
  graph rather than groups

- If player has no friends: beat omitted

**Beat 5 --- What You Gave**

Surfaces creator points earned in the past 14 days.

- Copy: *\"4 of your questions were answered by friends. \[Top question
  text\] was your most-played.\"*

- Critical for keeping the creator loop emotionally alive

- If creator_points_earned = 0 over the cycle: beat omitted

**8.8.5 Closing --- Shareable Card**

The ceremony ends with a shareable card:

- Composed in the mastery momentum format (per v10.25 §8.36, preserved
  unchanged)

- One-tap copy / share via native share sheet

- Card design: ink-on-cream, biweekly cycle dates, top mastery event of
  the cycle, no leaderboard data

**8.8.6 Cadence Anchor**

A player\'s biweekly cycle is anchored to their account creation date
(day-of-week + time-of-day). Examples:

- Player joined Tuesday 4pm → ceremonies fire every other Tuesday
  morning

- Player joined Friday 9am → ceremonies fire every other Friday morning

This avoids global sync (which creates SMS volume spikes and removes
personalization) and keeps the moment private to the player\'s own
rhythm.

If a player misses the in-app ceremony window (7 days), the next
ceremony still fires on schedule. Missed ceremonies are accessible from
Account → Past Reflections.

**8.9 Intellectual Alignment**

**8.9.1 Concept**

Intellectual alignment is a per-pair score between the player and each
friend, representing the degree of shared intellectual territory. It
surfaces in:

- Friend profiles (overlap markers on the Knowledge Portrait)

- Biweekly ceremony Beat 4 (\"Your Closest Alignment\")

**8.9.2 Calculation**

Alignment between Player A and Player B is computed across all questions
exchanged or co-experienced:

- Questions A wrote that B answered correctly (and vice versa)

- Questions both A and B answered correctly in the same domain

- Domains both A and B have demonstrated activity in (per Knowledge
  base)

- Weighted by the depth of demonstrated activity (Solid \> Familiar \>
  Establishing)

The calculation produces a normalized 0--100 score. Mechanics derived
from v10.25 §8.14, adapted to the friend graph.

**8.9.3 Display**

Alignment scores are **never** displayed as raw numbers in the UI. They
surface only as:

- Ranked friend lists (\"most aligned with\") in the biweekly ceremony

- Highlighted overlap markers on the Knowledge Portrait

- Optional \"X domains in common\" text on friend profiles

The score is internal infrastructure for ranking; it is not a
player-facing metric. This is intentional --- exposing alignment as a
score would convert intellectual identity into a comparison metric,
which violates §3.4.

**8.10 Points & Mastery**

**8.10.1 Tier System (preserved from v10.25 §8.32)**

  --------------------------------------
  **Tier**       **Threshold**
  -------------- -----------------------
  Establishing   0 points

  Familiar       50 points

  Solid          200 points

  Mastery        500 points + 20%
                 creator points
  --------------------------------------

Mastery tier requires the 20% creator points rule: at least 20% of the
player\'s points in that domain must be creator points (earned by
friends correctly answering questions the player wrote in that domain).

This rule preserves the v10.25 principle that Mastery is not a thing you
can reach by consumption alone --- you must contribute to a domain to
truly master it.

**8.10.2 Point Sources**

  ------------------------------------------------------------------------
  **Source**          **Points per correct answer**        **Notes**
  ------------------- ------------------------------------ ---------------
  Daily Five          1.0 × difficulty multiplier          

  Feed answer         1.0 × difficulty multiplier          

  Direct-sent answer  1.0 × difficulty multiplier          

  Personal Round      1.0 × difficulty multiplier          

  Catch-up (any       0.25 × difficulty multiplier         
  source)                                                  

  Creator points      0.5 per friend correct answer to     
                      your authored question               

  Imported-question   0.25 per friend correct answer to    Original author
  creator credit      your imported-and-forwarded question still gets 0.5
  ------------------------------------------------------------------------

Difficulty multipliers (Normal 1.0x, Moderate 1.25x, Challenging 1.5x,
Ridiculous 2.0x, Adaptive based on actual served difficulty).

**8.10.3 Tier Display**

Tiers are surfaced:

- On the Knowledge page (color intensity of domain circles)

- In the Daily Five end-of-session summary (when a tier crossing occurs)

- In the biweekly ceremony Beat 1

- On friend profiles (overlap markers)

Tiers are **never** surfaced as a leaderboard or ranked list across
players.

**8.10.4 Creator Points**

Creator points are earned when a friend correctly answers a question the
player wrote. Mechanics:

- Question written by Player A and answered by Player B → if B correct,
  A receives 0.5 creator points in the question\'s domain

- Question imported from Player A by Player B and forwarded to Player C
  → if C correct, A receives 0.5 (original author) and B receives 0.25
  (curator)

- Creator points contribute to the 20% Mastery threshold

Creator points are tracked separately from regular points but accumulate
into the same tier total.

**8.11 SMS Notifications**

  ----------------------------------------------------------------------------
  **Trigger**             **SMS Copy**                           **Default**
  ----------------------- -------------------------------------- -------------
  OTP for auth            *Your Joshing code: NNNNNN*            Always

  Daily Five ready        *Your five for today.* \[link\]        ON, opt-out

  Friend sent you a       *Greg sent you a question.* \[link\]   ON, opt-out
  question                                                       

  Friend thought your     *Maya thought your Sondheim question   OFF, opt-in
  question was excellent  was excellent.*                        

  Friend answered your    *Robyn answered your Mrs. Dalloway     OFF, opt-in
  question                question.*                             

  Friend reaction to your *Greg reacted to your question.*       OFF, opt-in
  question                                                       

  Friend invitation       *Maya joined Joshing --- you\'re now   ON, opt-out
  accepted                friends.*                              

  Friend request received *Greg wants to be friends on Joshing.* ON, opt-out
                          \[link\]                               

  Biweekly ceremony ready *Two weeks of Joshing. Here\'s what    ON, opt-out
                          you\'ve been up to.* \[link\]          
  ----------------------------------------------------------------------------

All notifications respect a quiet-hours window (default 9pm--8am
player-local). OTP and friend-sent-question notifications can override
quiet hours (toggle in settings).

**8.12 Home & Navigation**

**8.12.1 Home Hub**

The Home screen surfaces:

- **Today\'s Daily Five status** --- large card showing: *\"Your five
  today: \[3 of 5 done\]\"* (or *\"Ready when you are\"* if untouched)

- **Feed indicator** --- small text: *\"3 new in your Feed\"*
  (suppressed if 0)

- **Floating \"Write a question\" button** --- bottom-right, persistent

Below the fold:

- **Biweekly ceremony preview** --- appears in the 24h before ceremony
  fires: *\"Your two-week reflection arrives tomorrow.\"*

- **Friend activity summary** --- quiet line: *\"Maya and Greg played
  today.\"* (no detail, just presence)

**8.12.2 Navigation**

Bottom nav (mobile) / left rail (desktop), 4 items:

  -----------------------------------------------------------
  **Icon**   **Label**   **Destination**
  ---------- ----------- ------------------------------------
  Home       Home        §8.12.1

  Stream     Feed        §8.2

  Map        Knowledge   §8.4.8

  Person     Account     Settings, profile, friends, archive,
                         past reflections
  -----------------------------------------------------------

The \"Account\" tab contains:

- Edit profile (display name, declared interests)

- Friends (list, add, remove)

- Archive (§8.7)

- Past reflections (archived biweekly ceremonies)

- Settings (notifications, difficulty default, quiet hours)

- Plus tier (TBD per §11)

- Sign out / Delete account

**8.13 Design Principles (carried from v10.25 §16, modified)**

1.  **Quiet over loud.** No urgency, no streaks, no badges, no
    leaderboards. The product is intelligent and calm.

2.  **Specific over general.** Hyper-specificity in domains, in
    questions, in copy. \"Late Tchaikovsky\" not \"Music.\"

3.  **Practice over performance.** The Daily Five is private. Friend
    profiles are intellectual portraits, not scoreboards.

4.  **Curation over authorship.** The social layer is built on thumbs-up
    and send-to-friend, not on writing-for-others.

5.  **Friends as expansion.** The Knowledge base grows through people.
    The mechanic encodes a true thing about how intellectual life
    expands.

6.  **One ritual, one ceremony.** The Daily Five is the ritual. The
    biweekly is the ceremony. Don\'t add more moments.

7.  **Editorial register.** Ink-on-cream, considered typography, no
    animation gratuitousness. The product reads like a quiet
    publication.

8.  **Web-first, SMS-anchored.** No native apps. The invitation arrives
    as a text from a friend.

9.  **Invitation as gift.** Every player was brought here by someone.
    The invitation flow is dignified, never viral-mechanic.

10. **The only moment Joshing speaks loudly is the biweekly ceremony.**
    Everything else is whispered.


## §8.14 — Joshing Game

### 8.14.1 Concept

A Joshing Game is a curated 5-question set that one player creates and sends
to one or more friends. It is the highest-intent social gesture in the product —
more deliberate than thumbs-upping a question in the Feed, more personal than
a direct send. The sender gives it a title, picks the questions, and chooses
who receives it. Every recipient plays the same five questions.

The Joshing Game is not a group game. There are no rounds, no seasons, no daily
cadence. It is finite, titled, and authored — closer to a playlist than a game
in the v10.25 sense.

### 8.14.2 Creation Flow

Three steps, in order:

**Step 1 — Title**
A single text field. Required. Prompt copy:
*"What's this one called?"*
Examples: "Summer Road Trip Music", "Are You Sure You Read That?", "For Maya Only"
Max 60 characters.

**Step 2 — Recipients**
Friend picker. Multiple selection allowed. Minimum 1. No cap in v11.0
(revisit if spam patterns emerge). Shows all confirmed friends, most recent
interaction at top. The same game — identical questions — is sent to all
selected recipients.

**Step 3 — Questions**
Player selects or writes up to 5 questions. Maximum is 5. Minimum is 1
(a single-question Joshing Game is valid).

Two entry points within Step 3:

- **From bank:** `QuestionBankPicker` component (already exists at
  `app/src/components/QuestionBankPicker.tsx`) surfaces the player's existing
  question bank. Questions already used in a prior Joshing Game are flagged
  but not blocked. One-tap to add.

- **Write new:** `QuestionForm` component (already exists at
  `app/src/components/QuestionForm.tsx`) with LLM answer suggestion. Newly
  written questions are automatically saved to the player's bank and added
  to the game simultaneously.

Questions are ordered by the sender (drag to reorder). Position is preserved
for all recipients.

**Confirmation screen:**
Shows title, recipient count, question count, and a send button.
Copy: *"Send [Title] to [N] friend[s]."*
On send: game is created, feed items are written for all recipients, SMS
notifications fire.

### 8.14.3 Entry Points

- Floating "Write a question" button on Home (existing pattern) — add a
  "Make a Joshing Game" option alongside the standalone write flow
- From a friend's profile: "Send a Joshing Game" CTA
- From the question bank: select multiple questions → "Make a Joshing Game"

### 8.14.4 Recipient Experience

A Joshing Game appears in the recipient's Feed as a **game card** — visually
distinct from a single-question feed item. The card shows:

- Game title (prominent)
- Sender attribution: *"From [Name]"*
- Question count: *"5 questions"*
- Completion status of all recipients (see §8.14.6)
- CTA: *"Play"* (if unanswered) / *"See results"* (if answered)

Tapping "Play" opens the chat thread interface — the same `GameplayChat`
component at `app/src/components/play/GameplayChat.tsx` — scoped to the
Joshing Game's 5 questions. Sequential reveal, same mechanic as the Daily Five.
No timer. No expiry.

The game card persists in the Feed indefinitely. It does not roll off at the
25-item cap — Joshing Game cards are pinned and exempt from the cap.

### 8.14.5 The Game Card in the Feed
┌─────────────────────────────────────────────────┐ │ 🎯 Are You Sure You Read That? │ │ From Greg │ │ │ │ Maya ✅ 4/5 │ │ Sam ⏳ Playing... │ │ You — Not started │ │ │ │ [Play] 5 questions │ └─────────────────────────────────────────────────┘



Results are visible to all recipients once they have played. A recipient
who has not yet played sees other players' result counts but not their
individual answers. Once the viewing recipient plays, all answers unlock.

### 8.14.6 Results Visibility Rules

| Viewer status | What they see |
|---|---|
| Has not played | Other players' scores (X/5) but not their per-question answers |
| Has played | Full results for all players — per question, per player |
| Sender | Full results for all players at all times |

This mirrors the current v10.25 game behavior, adapted for the smaller scale.

### 8.14.7 Mastery and Points

Answers in a Joshing Game count at full weight (1.0x) toward mastery —
identical to Feed answers and Daily Five answers. The same `answer_state`
rules apply (`first_correct`, `first_correct_after_wrong`, `repeat_correct`,
`incorrect`).

Creator points: the sender earns creator points (per §8.10.4) when any
recipient correctly answers a question the sender wrote. For questions pulled
from the sender's bank (originally written by someone else), the original
author still receives creator points. The sender receives curator credit
(0.5x) for forwarded questions, per the existing bank-add provenance rules.

### 8.14.8 Game Summary

The Joshing Game has a full game summary page. No ceremony. The summary page
is adapted from the existing game summary pattern in v10.25 — the route,
component structure, and data shape are reused with modifications.

**Route:** `/games/[joshingGameId]/summary`

**Reused from v10.25:**
- `app/src/app/components/games/game-details-mode-sections.tsx` — section
  structure (adapted)
- `app/src/app/components/games/interpretive-sections.tsx` — interpretive copy
  (adapted)
- `app/src/lib/games/summary.ts` — summary data assembly (adapted)
- `app/src/lib/games/details-transformers.ts` — data shaping (adapted)

**Summary sections (in order):**

**1. The Story** — what happened in this game collectively
- Title and sender
- Total recipients, total answers submitted
- Hardest question (lowest correct rate across recipients)
- Everyone knew this (highest correct rate)
- Most loved (highest thumbs-up count among recipients)

**2. Your Game** — the viewing player's personal result
- Questions answered and correct count
- Category-level strengths surfaced from correct answers
- "Only you got this" moment if applicable

**3. What You Discovered** — missed questions
- All questions the player got wrong or skipped
- Full correct answer + educational explainer
- Creator note if present
- Replay link

**4. How Everyone Did** — the group result view
- Per-recipient result card: name, score (X/5), strongest category
- Per-question breakdown: who got it right across all recipients

The summary persists indefinitely. It is accessible from:
- The game card in the Feed ("See results")
- The sender's Activities tab
- The recipient's Activities tab

### 8.14.9 Data Model

See §20 (Schema) for full table definitions. Core tables:

- `JoshingGame` — title, creatorId, createdAt
- `JoshingGameRecipient` — gameId, userId, sentAt
- `JoshingGameQuestion` — gameId, questionId, position
- `JoshingGameResponse` — gameId, questionId, userId, submittedAnswer,
  isCorrect, isPartial, pointsAwarded, answeredAt

### 8.14.10 SMS Notifications

| Trigger | Copy | Default |
|---|---|---|
| Game received | *"[Name] sent you a Joshing Game: [Title]. [link]"* | ON, opt-out |
| Recipient completes game | *"[Name] played [Title]. [link]"* | ON, opt-out |
| All recipients complete | *"Everyone played [Title]. See the results. [link]"* | ON, opt-out |

### 8.14.11 Activities Surface

Joshing Games surface in the Activities tab (§8.15) as:
- Games sent (with completion status)
- Games received (with play status)
- Results when all recipients have played

---

## §8.15 — Activities Tab

### 8.15.1 Concept

Activities is the fifth nav item. It is the notification and history layer
for everything social in Joshing — friend activity, incoming games, mastery
moments from friends, and the biweekly ceremony signal.

Activities is not a feed of content to consume. It is a record of things
that happened, organized by recency.

### 8.15.2 Navigation

Activities is added as the fifth item in the primary nav:

Home | Feed | Knowledge | Activities | Account



The Activities icon shows a quiet unread count badge (number, not a red dot)
when there are unread items. Badge suppresses at 0.

### 8.15.3 Item Types

All items are reverse-chronological. Unread items are visually distinct
(subtle left border or background tint — not a badge per item).

**1. Received Joshing Game**
*"[Name] sent you a Joshing Game: [Title]"*
CTA: Play → opens game in chat thread interface
Sub-state when played: *"[Name] sent you [Title] · You got 4/5"* → See results

**2. Joshing Game Results**
Fires when all recipients of a game you sent have played.
*"Everyone played [Title]"*
CTA: See results → summary page

**3. Friend Mastery Crossing**
Fires when any friend crosses any tier threshold (Establishing→Familiar,
Familiar→Solid, Solid→Mastery).
*"[Name] reached [Tier] in [Domain]"*
No CTA required. Tap → friend's profile.

**4. Biweekly Ceremony Ready**
*"Your two-week reflection is ready"*
This item appears in Activities AND as a banner at the top of the Feed
(the banner auto-dismisses once the ceremony is viewed).
CTA: See it now → ceremony

**5. Friend Request Received**
*"[Name] wants to be friends on Joshing"*
Inline CTA: Accept / Ignore (no navigation required)
On accept: friendship formed, item updates to *"You and [Name] are now friends"*

**6. Joshing Game Progress**
Fires when a recipient plays a game you sent (not yet all done).
*"[Name] played [Title] · [N] of [Total] have played"*
CTA: See so far → summary page

### 8.15.4 What Activities Does Not Show

- Daily Five results (private, not social)
- Feed thumbs-up activity from friends (that surfaces in the Feed itself)
- Mastery events from the player's own play (those are on the Knowledge page)
- Any competitive ranking information

### 8.15.5 Ceremony Banner in Feed

When the biweekly ceremony is ready, a non-intrusive banner appears at the
top of the Feed (above the first feed item):

┌─────────────────────────────────────────────────┐ │ ✦ Your two-week reflection is ready │ │ See what you've been up to → │ └─────────────────────────────────────────────────┘



The banner dismisses when the ceremony is opened. It does not reappear
for the same ceremony. It does not count as an Activities unread item —
the Activities item for the ceremony remains until the ceremony is viewed.

### 8.15.6 Data Model

`ActivityItem` table — see §20 (Schema) for full definition.

Key fields: userId (recipient), type (enum), actorUserId, referenceId,
referenceType, read (boolean), createdAt.

Activity items are written server-side when the triggering event occurs.
They are never generated client-side.

**Retention:** Activity items older than 90 days are soft-deleted from
the surface (remain in DB for audit). Exception: Joshing Game items
persist as long as the game exists.

### 8.15.7 Unread Count

Unread count = count of ActivityItem rows where userId = current user
AND read = false AND createdAt > 90 days ago.

Marked as read: when the player opens the Activities tab, all visible
items are marked read in a single batch write. Not read-on-view for
individual items — the whole tab clears on open.

---

## Amendment to §8.12 — Home & Navigation

### 8.12.2 Navigation (updated)

Bottom nav (mobile) / left rail (desktop), **5 items**:

| Icon | Label | Destination |
|---|---|---|
| Home | Home | §8.12.1 |
| Stream | Feed | §8.2 |
| Map | Knowledge | §8.4.8 |
| Bell | Activities | §8.15 |
| Person | Account | Settings, profile, friends, archive, past reflections |

The "Account" tab contains all items listed in the original §8.12.2,
unchanged.

---

## §20 — Schema (SQL)

Complete schema for v11.0. Written as raw SQL for use with Drizzle Kit
migrations.

### Tables Dropped from v10.25

The following tables are explicitly dropped. Do not carry them forward.

```sql
-- DROP in this order to respect foreign keys:
DROP TABLE IF EXISTS "ChallengeAnswer";
DROP TABLE IF EXISTS "ChallengeQuestion";
DROP TABLE IF EXISTS "ChallengeSession";
DROP TABLE IF EXISTS "Challenge";
DROP TABLE IF EXISTS "GroupKnowledgeMap";
DROP TABLE IF EXISTS "CompatibilityScore";
DROP TABLE IF EXISTS "DailyAssignment";
DROP TABLE IF EXISTS "DailySession";
DROP TABLE IF EXISTS "GameQuestion";
DROP TABLE IF EXISTS "Game";
DROP TABLE IF EXISTS "GroupMember";
DROP TABLE IF EXISTS "Group";
DROP TABLE IF EXISTS "PublicRun";
DROP TABLE IF EXISTS "StarVote"; -- replaced by thumbs_upped flag on responses
DROP TABLE IF EXISTS "FlagReport";
DROP TABLE IF EXISTS "InviteLink"; -- replaced by Friendship + Invitation
DROP TABLE IF EXISTS "AppNotification"; -- replaced by ActivityItem
DROP TABLE IF EXISTS "CeremonyProgress"; -- replaced by BiweeklyCeremony
Tables Kept Unchanged
The following tables carry forward with no structural changes:

Sql

-- Keep as-is:
-- User (modified below)
-- UserSession
-- OtpCode
-- Question (modified below)
-- QuestionAudienceTag
-- UserQuestionBank
-- PlayerMastery
-- MasteryEvent
-- QuestionReaction
-- GradeDispute
-- SmsLog
-- PlayerSubscription
-- GeneratedQuestion
-- QuestionFeedback
-- DailyQueue (renamed — see below)
-- DailyPreference
-- SkippedDailyQuestion
-- UserDomainDifficulty
-- UserDomainExclusion
-- ProfileDomainVisibility
-- UserQuestionHistory
Tables Modified from v10.25
Sql

-- USERS: add v11.0 fields, drop group-specific fields
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "slug" TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "authorProfilePublic" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "onboardingComplete" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "adaptiveLevel" FLOAT NOT NULL DEFAULT 1.0;
  -- adaptiveLevel: 1.0 = Normal, 2.0 = Moderate, 3.0 = Challenging, 4.0 = Ridiculous

-- QUESTIONS: no structural drops needed; group-scoped fields are nullable
-- and harmless. Add v11.0 sharing flag if not present:
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "sharedToFriendsFeed" BOOLEAN NOT NULL DEFAULT FALSE;
  -- sharedToFriendsFeed: true = eligible to appear in friends' Feeds via thumbs-up

-- DailyQueue: rename to reflect v11.0 role as the Daily Five queue
-- (keep same structure; the existing columns map cleanly)
-- No ALTER needed — name is internal. Document that DailyQueue = Daily Five queue.
New Tables
Sql

-- ─────────────────────────────────────────────
-- DECLARED INTERESTS
-- ─────────────────────────────────────────────

CREATE TABLE "DeclaredInterest" (
  "id"            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"        TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "domain"        TEXT        NOT NULL,
  -- Hyper-specific: "Late Tchaikovsky", not "Music"
  "broadCategory" TEXT,
  -- E.g. "Classical Music" — used for Knowledge page clustering
  "declaredAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "isActive"      BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Hard cap of 5 isActive=true per user enforced at application layer
  -- (CHECK constraint intentionally omitted — app enforces, not DB)
  UNIQUE ("userId", "domain")
);

CREATE INDEX "DeclaredInterest_userId_isActive_idx"
  ON "DeclaredInterest"("userId", "isActive");


-- ─────────────────────────────────────────────
-- FRIENDSHIPS
-- ─────────────────────────────────────────────

CREATE TABLE "Friendship" (
  "id"                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userAId"           TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "userBId"           TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  -- Convention: userAId < userBId (alphabetically) to prevent duplicate pairs
  "status"            TEXT        NOT NULL DEFAULT 'pending',
  -- 'pending' | 'active' | 'removed'
  "requestedByUserId" TEXT        NOT NULL REFERENCES "User"("id"),
  "formedVia"         TEXT        NOT NULL,
  -- 'invitation' | 'in_app_request'
  "formedAt"          TIMESTAMPTZ,
  -- Set when status transitions to 'active'
  "removedAt"         TIMESTAMPTZ,
  "removedByUserId"   TEXT        REFERENCES "User"("id"),
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("userAId", "userBId")
);

CREATE INDEX "Friendship_userAId_status_idx" ON "Friendship"("userAId", "status");
CREATE INDEX "Friendship_userBId_status_idx" ON "Friendship"("userBId", "status");


-- ─────────────────────────────────────────────
-- FEED ITEMS
-- ─────────────────────────────────────────────

CREATE TABLE "FeedItem" (
  "id"              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "recipientUserId" TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "questionId"      TEXT        REFERENCES "Question"("id"),
  -- Null when sourceType = 'joshing_game'
  "joshingGameId"   TEXT,
  -- FK added after JoshingGame table created (below)
  "sourceType"      TEXT        NOT NULL,
  -- 'direct_sent' | 'authored_shared' | 'thumbs_upped' | 'joshing_game'
  "sourceUserId"    TEXT        NOT NULL REFERENCES "User"("id"),
  "sourceEventAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "state"           TEXT        NOT NULL DEFAULT 'active',
  -- 'active' | 'answered' | 'skipped' | 'dismissed' | 'rolled_off'
  -- Note: joshing_game cards use 'active' | 'played' | 'dismissed' only
  "isPinned"        BOOLEAN     NOT NULL DEFAULT FALSE,
  -- TRUE for joshing_game cards and direct_sent — exempt from 25-item cap
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "FeedItem_recipientUserId_state_idx"
  ON "FeedItem"("recipientUserId", "state", "sourceEventAt" DESC);
CREATE INDEX "FeedItem_recipientUserId_pinned_idx"
  ON "FeedItem"("recipientUserId", "isPinned")
  WHERE "isPinned" = TRUE;


-- ─────────────────────────────────────────────
-- JOSHING GAME
-- ─────────────────────────────────────────────

CREATE TABLE "JoshingGame" (
  "id"        TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "title"     TEXT        NOT NULL,
  "creatorId" TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "JoshingGame_creatorId_idx" ON "JoshingGame"("creatorId");

-- Add FK from FeedItem now that JoshingGame exists
ALTER TABLE "FeedItem"
  ADD CONSTRAINT "FeedItem_joshingGameId_fkey"
  FOREIGN KEY ("joshingGameId") REFERENCES "JoshingGame"("id") ON DELETE SET NULL;


CREATE TABLE "JoshingGameRecipient" (
  "id"       TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "gameId"   TEXT        NOT NULL REFERENCES "JoshingGame"("id") ON DELETE CASCADE,
  "userId"   TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "sentAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("gameId", "userId")
);

CREATE INDEX "JoshingGameRecipient_userId_idx"
  ON "JoshingGameRecipient"("userId");
CREATE INDEX "JoshingGameRecipient_gameId_idx"
  ON "JoshingGameRecipient"("gameId");


CREATE TABLE "JoshingGameQuestion" (
  "id"         TEXT    PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "gameId"     TEXT    NOT NULL REFERENCES "JoshingGame"("id") ON DELETE CASCADE,
  "questionId" TEXT    NOT NULL REFERENCES "Question"("id"),
  "position"   INTEGER NOT NULL,
  -- 1-based, 1 through 5
  UNIQUE ("gameId", "position"),
  UNIQUE ("gameId", "questionId")
);


CREATE TABLE "JoshingGameResponse" (
  "id"              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "gameId"          TEXT        NOT NULL REFERENCES "JoshingGame"("id") ON DELETE CASCADE,
  "questionId"      TEXT        NOT NULL REFERENCES "Question"("id"),
  "userId"          TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "submittedAnswer" TEXT,
  -- Null if skipped without answering
  "isCorrect"       BOOLEAN,
  "isPartial"       BOOLEAN     NOT NULL DEFAULT FALSE,
  "answerState"     TEXT,
  -- 'first_correct' | 'first_correct_after_wrong' | 'repeat_correct' | 'incorrect'
  -- Mirrors the existing answer_state enum pattern from v10.25
  "pointsAwarded"   FLOAT,
  "answeredAt"      TIMESTAMPTZ,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("gameId", "questionId", "userId")
);

CREATE INDEX "JoshingGameResponse_gameId_userId_idx"
  ON "JoshingGameResponse"("gameId", "userId");
CREATE INDEX "JoshingGameResponse_userId_idx"
  ON "JoshingGameResponse"("userId");


-- ─────────────────────────────────────────────
-- BIWEEKLY CEREMONY
-- ─────────────────────────────────────────────

CREATE TABLE "BiweeklyCeremony" (
  "id"            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"        TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "cycleStart"    DATE        NOT NULL,
  "cycleEnd"      DATE        NOT NULL,
  "firedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "viewedAt"      TIMESTAMPTZ,
  "beatsPayload"  JSONB       NOT NULL,
  -- Snapshot of all 5 beats at fire time — never recomputed after fire
  "shareCardToken" TEXT       UNIQUE
);

CREATE INDEX "BiweeklyCeremony_userId_firedAt_idx"
  ON "BiweeklyCeremony"("userId", "firedAt" DESC);


-- ─────────────────────────────────────────────
-- ACTIVITY ITEMS
-- ─────────────────────────────────────────────

CREATE TABLE "ActivityItem" (
  "id"              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"          TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  -- The player who receives this activity notification
  "type"            TEXT        NOT NULL,
  -- 'received_joshing_game' | 'joshing_game_result' | 'joshing_game_progress'
  -- | 'friend_mastery' | 'ceremony_ready' | 'friend_request' | 'friend_request_accepted'
  "actorUserId"     TEXT        REFERENCES "User"("id") ON DELETE SET NULL,
  "referenceId"     TEXT,
  -- The id of the related entity
  "referenceType"   TEXT,
  -- 'joshing_game' | 'ceremony' | 'friendship' | 'mastery_event'
  "read"            BOOLEAN     NOT NULL DEFAULT FALSE,
  "deletedAt"       TIMESTAMPTZ,
  -- Soft delete after 90 days (except joshing_game types)
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "ActivityItem_userId_read_idx"
  ON "ActivityItem"("userId", "read", "createdAt" DESC);
CREATE INDEX "ActivityItem_userId_createdAt_idx"
  ON "ActivityItem"("userId", "createdAt" DESC);


-- ─────────────────────────────────────────────
-- FRIENDSHIP INVITATION
-- Replaces InviteLink for the v11.0 friendship formation flow
-- ─────────────────────────────────────────────

CREATE TABLE "FriendInvitation" (
  "id"                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "inviterUserId"       TEXT        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "inviteePhone"        TEXT        NOT NULL,
  -- E.164 format; cleared after invitee authenticates
  "inviteeUserId"       TEXT        REFERENCES "User"("id"),
  -- Set when invitee signs up and accepts
  "preSeededInterests"  JSONB,
  -- Array of {domain, broadCategory} — up to 3
  "personalMessage"     TEXT,
  "token"               TEXT        NOT NULL UNIQUE,
  -- In the invitation link URL
  "sentAt"              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "acceptedAt"          TIMESTAMPTZ,
  "expiresAt"           TIMESTAMPTZ NOT NULL
  -- 7 days after sentAt
);

CREATE INDEX "FriendInvitation_token_idx" ON "FriendInvitation"("token");
CREATE INDEX "FriendInvitation_inviterUserId_idx"
  ON "FriendInvitation"("inviterUserId");

**End of Chunk 2.**

React to anything before I move to Chunk 3 (Sections 9--20: LLM, Data
Model, SMS, Performance, Monetization, Architecture, Out of Scope,
Metrics, Open Questions, Sample Questions). Things worth checking
specifically:

- **§8.1.5 Difficulty calibration** --- the explicit \"Normal questions
  should test moderately-engaged-with-the-domain knowledge\" instruction
  --- does that capture the recalibration ask?

- **§8.3.4 Creator points for forwarded questions** --- I made up the
  0.5x curator rate; want to check that.

- **§8.4.7 Domain merge** --- is end-of-biweekly-cycle the right
  cadence? Should there also be a manual \"consolidate\" trigger from
  the Knowledge page?

- **§8.8.4 Beat 5** --- the most-played question copy assumes we have
  play counts per question; that\'s a data requirement worth confirming.

- **§8.10.2 Point sources** --- the imported-question split (original
  author 0.5, curator 0.25) --- does that economy feel right?

- **§8.12.1 Home** --- the \"Friend activity summary\" line (\"Maya and
  Greg played today\") --- does that tip into surveillance, or is it a
  nice ambient signal? Worth a sanity check.

- **§8.13 Principles** --- anything missing or anything that\'s there
  that shouldn\'t be?

Producing **Chunk 3 of 3**: Sections 9--20. This completes the v11.0
PRD.

**9. LLM Integration**

**9.1 Overview**

LLM is used in five places in Joshing v11.0:

1.  **Daily Five question generation** --- calibrated to the player\'s
    Knowledge base, difficulty, and selected domains

2.  **Domain auto-categorization** --- when a question is created (by
    player or for Daily Five), the LLM assigns a hyper-specific domain

3.  **Onboarding interest proposals** --- the LLM proposes 8--12
    candidate interests from warm-up answers

4.  **Answer grading** --- semantic evaluation when the deterministic
    answer-key check fails

5.  **Domain merge/split** --- at end of biweekly cycle, evaluates the
    player\'s domain list for consolidation

6.  **Answer suggestion** --- when a player writes a question and taps
    \"Suggest answer\"

Each is a distinct prompt, with distinct constraints and outputs.

**9.2 Daily Five Question Generation**

**9.2.1 Inputs to the prompt**

- Player\'s Knowledge base (declared interests + demonstrated domains)

- Player\'s recent correct rate per domain (rolling 30-day window)

- Selected domains for today (Random or Custom subset)

- Player\'s chosen difficulty (Normal / Moderate / Challenging /
  Ridiculous / Adaptive)

- For Adaptive: current adaptive level (initialized at Normal, updated
  per session)

- Player\'s recent question history (to avoid repetition --- last 60
  questions)

- Target correct rate per difficulty (per §8.1.5)

**9.2.2 Prompt constraints**

The generation prompt explicitly instructs:

- Questions must have a single correct answer (with optional acceptable
  variants)

- Questions must be factual, not opinion-based

- Hyper-specific domain --- no general-knowledge fallback

- **Normal-tier difficulty must test material a moderately-engaged
  player would know**, not deep cuts or trivia-of-trivia

- Avoid \"what year was X recorded\" when \"what was X\" is more
  meaningful

- Avoid questions that depend on having read a specific recent source

- One question per call, with structured output: {question,
  correct_answer, acceptable_variants\[\], domain, difficulty,
  brief_explainer}

**9.2.3 Output validation**

Each generated question is checked before serving:

- Domain matches a domain in the player\'s Knowledge base (otherwise
  discard)

- Question text is non-empty and \< 500 chars

- Correct answer is non-empty

- Brief explainer is \< 280 chars

- Question is not a near-duplicate of one in the player\'s recent
  history (similarity check via embedding)

Failed validations trigger regeneration (max 3 retries before falling
through to next domain).

**9.2.4 Adaptive difficulty algorithm**

After each Daily Five session where the player has Adaptive set:

- Compute session correct rate (X correct of Y answered)

- If correct rate \> 75%: bump adaptive level up by 0.5 sub-tier

- If correct rate \< 45%: bump adaptive level down by 0.5 sub-tier

- Otherwise: hold steady

- Adaptive level ranges from Normal to Ridiculous, in 0.5 increments

- The next Daily Five generates at the new level

**9.3 Domain Auto-Categorization (preserved from v10.25 §9.1, refined)**

When any question is created (player-authored or LLM-generated), the LLM
assigns:

- A **hyper-specific canonical domain** (e.g., \"Late Tchaikovsky\")

- A **broad category** (e.g., \"Classical Music\") --- used for the
  Knowledge page circles-by-category clustering

Constraints:

- Hyper-specificity is enforced at categorization (no \"Music\" /
  \"Literature\" / \"History\")

- The LLM is given the player\'s existing domain list to encourage
  canonical reuse

- If a question doesn\'t fit any existing domain, a new domain is
  created with the LLM\'s proposed name

- Player can override the LLM\'s domain assignment when creating their
  own questions

**9.4 Onboarding Interest Proposals**

Inputs: 4--6 free-text warm-up answers.

The LLM generates 8--12 candidate interests at hyper-specific
granularity. Each candidate includes:

- A short label (e.g., \"Late-Period Bowie\")

- A brief description (1 sentence) shown on hover/tap

The player selects up to (5 minus already-accepted-pre-seeded) and can
edit any candidate inline before locking.

**9.5 Answer Grading**

Two-stage:

1.  **Deterministic check** against correct_answer +
    acceptable_variants\[\] with normalization (case, punctuation,
    whitespace, common abbreviations)

2.  **LLM semantic evaluation** if step 1 fails --- returns correct /
    partial / incorrect with confidence

Partial credit (50% weight) is conservative. The LLM is prompted to
favor incorrect over partial when uncertain.

**9.6 Domain Merge & Split (biweekly)**

At end of each player\'s biweekly cycle, the LLM is given the player\'s
full domain list (with question counts) and asked to propose:

- **Merges**: domain groups that should be consolidated (e.g., three
  Bach WTC variants → one)

- **Splits**: single domains that have accumulated divergent content

Proposed changes are applied silently before the biweekly ceremony
surface displays. Tier recalculations happen automatically.

The LLM is instructed to be **aggressive on merges** (fragmentation is
the larger risk) and **conservative on splits** (only split when content
has clearly diverged).

**9.7 Answer Suggestion (preserved from v10.25 §8.2)**

When a player writes a question and taps \"Suggest answer,\" the LLM
proposes an answer from the question text. Player can accept, edit, or
reject. Behavior identical to v10.25.

**9.8 Model Selection & Cost**

- Daily Five generation: high-quality model (e.g., Claude Sonnet, GPT-4o
  equivalent) --- quality matters

- Categorization, grading, suggestion: smaller / faster model (e.g.,
  Haiku, GPT-4o-mini) --- latency matters

- Domain merge/split: high-quality model --- runs infrequently, accuracy
  matters

Estimated cost per active player per month: TBD pending pilot data.
Budget assumption: \< \$2/MAU.

**10. Data Model**

**10.1 Schema Overview**

The v11.0 data model is a substantial simplification of v10.25.
Group-related tables are dropped; new tables added for the friend graph
and Feed.

**10.2 Core Tables**

**USERS**

  ---------------------------------------------------------------------------
  **Field**            **Type**      **Notes**
  -------------------- ------------- ----------------------------------------
  user_id              UUID PK       

  phone_number         string,       E.164 format, US only
                       unique        

  display_name         string        

  slug                 string,       For /users/\[slug\] URLs
                       unique        

  created_at           timestamp     Anchor for biweekly ceremony cadence

  tier                 enum          Free / Plus

  notification_prefs   json          Per-trigger opt-in/out

  quiet_hours_start    time          Default 21:00 local

  quiet_hours_end      time          Default 08:00 local

  adaptive_level       float         Current adaptive difficulty (Normal=1.0,
                                     Ridiculous=4.0)

  deleted_at           timestamp     Soft delete
                       nullable      
  ---------------------------------------------------------------------------

**DECLARED_INTERESTS**

  -----------------------------------------
  **Field**     **Type**    **Notes**
  ------------- ----------- ---------------
  interest_id   UUID PK     

  user_id       FK USERS    

  domain_id     FK DOMAINS  

  declared_at   timestamp   

  is_active     boolean     False if
                            swapped out
  -----------------------------------------

Constraint: max 5 is_active = true rows per user.

**DOMAINS**

  --------------------------------------------------------------------
  **Field**            **Type**        **Notes**
  -------------------- --------------- -------------------------------
  domain_id            UUID PK         

  canonical_name       string          Hyper-specific (e.g., \"Late
                                       Tchaikovsky\")

  broad_category       string          E.g., \"Classical Music\"

  created_at           timestamp       

  created_by_user_id   FK USERS        First user to encounter
                       nullable        
  --------------------------------------------------------------------

Domains are global (shared across users). When a user demonstrates
activity in a domain, it appears in their Knowledge base view (derived
from QUESTION_RESPONSES).

**QUESTIONS**

  -------------------------------------------------------------------------
  **Field**              **Type**        **Notes**
  ---------------------- --------------- ----------------------------------
  question_id            UUID PK         

  text                   text            

  correct_answer         string          

  acceptable_variants    json array      

  domain_id              FK DOMAINS      

  difficulty             enum            Normal / Moderate / Challenging /
                                         Ridiculous

  creator_note           text nullable   Per §8.5

  original_author_id     FK USERS        NULL for LLM-generated
                         nullable        

  is_llm_generated       boolean         

  is_shared_to_friends   boolean         If true, eligible for friend Feeds

  brief_explainer        text            Shown after grading

  created_at             timestamp       
  -------------------------------------------------------------------------

**QUESTION_RESPONSES**

  --------------------------------------------------------------------------
  **Field**          **Type**       **Notes**
  ------------------ -------------- ----------------------------------------
  response_id        UUID PK        

  question_id        FK QUESTIONS   

  user_id            FK USERS       

  submitted_answer   string         

  is_correct         boolean        

  is_partial         boolean        

  points_awarded     float          After all multipliers

  source             enum           daily_five / feed / direct_sent /
                                    personal_round / catch_up

  source_friend_id   FK USERS       Who sent or endorsed (for
                     nullable       feed/direct_sent)

  answered_at        timestamp      

  thumbs_upped       boolean        

  reaction_text      text nullable  If reaction sent
  --------------------------------------------------------------------------

This is the master record of all play. Everything else (mastery, points,
stats) is derivable from this.

**FRIENDSHIPS**

  --------------------------------------------------------------
  **Field**            **Type**        **Notes**
  -------------------- --------------- -------------------------
  friendship_id        UUID PK         

  user_a_id            FK USERS        Lower UUID

  user_b_id            FK USERS        Higher UUID

  formed_via           enum            invitation /
                                       in_app_request

  formed_at            timestamp       

  removed_at           timestamp       Soft delete; removal is
                       nullable        symmetric

  removed_by_user_id   FK USERS        
                       nullable        
  --------------------------------------------------------------

Constraint: unique on (user_a_id, user_b_id).

**INVITATIONS**

  -----------------------------------------------------------
  **Field**              **Type**        **Notes**
  ---------------------- --------------- --------------------
  invitation_id          UUID PK         

  inviter_user_id        FK USERS        

  invitee_phone          string          E.164

  invitee_user_id        FK USERS        Set on acceptance
                         nullable        

  pre_seeded_interests   json array      Up to 3 domain
                                         suggestions

  personal_message       text nullable   

  sent_at                timestamp       

  accepted_at            timestamp       
                         nullable        
  -----------------------------------------------------------

**FEED_ITEMS**

  -----------------------------------------------------------------------
  **Field**           **Type**      **Notes**
  ------------------- ------------- -------------------------------------
  feed_item_id        UUID PK       

  recipient_user_id   FK USERS      Whose feed this appears in

  question_id         FK QUESTIONS  

  source_type         enum          direct_sent / authored_shared /
                                    thumbs_upped

  source_user_id      FK USERS      The friend who triggered the item

  source_event_at     timestamp     When the trigger happened (for
                                    ordering)

  state               enum          active / answered / skipped /
                                    dismissed / rolled_off

  created_at          timestamp     
  -----------------------------------------------------------------------

Multi-friend endorsement (e.g., \"Greg + 2 others thumbed up\") is a
query-time aggregation, not separate rows. The display layer collapses
items where recipient_user_id + question_id + source_type = thumbs_upped
are identical.

**SENT_QUESTIONS**

  ---------------------------------------------
  **Field**           **Type**      **Notes**
  ------------------- ------------- -----------
  sent_id             UUID PK       

  sender_user_id      FK USERS      

  recipient_user_id   FK USERS      

  question_id         FK QUESTIONS  

  sent_at             timestamp     
  ---------------------------------------------

Used for: rate-limit enforcement (5/day/recipient), creator point
attribution, archive \"Sent by me\" filter.

**USER_QUESTION_BANK**

  -------------------------------------------------------------------
  **Field**               **Type**        **Notes**
  ----------------------- --------------- ---------------------------
  bank_entry_id           UUID PK         

  user_id                 FK USERS        

  question_id             FK QUESTIONS    

  imported_from_user_id   FK USERS        If added-to-bank from
                          nullable        another source

  added_at                timestamp       
  -------------------------------------------------------------------

**DAILY_FIVE_SESSIONS**

  ------------------------------------------------------------------
  **Field**               **Type**       **Notes**
  ----------------------- -------------- ---------------------------
  session_id              UUID PK        

  user_id                 FK USERS       

  session_date            date           

  difficulty_setting      enum           Player\'s setting at time
                                         of generation

  difficulty_served       float          Actual served level (for
                                         Adaptive)

  domain_selection_mode   enum           random / custom

  selected_domain_ids     json array     If custom

  question_ids            json array     The 5 questions

  generated_at            timestamp      

  completed_at            timestamp      
                          nullable       
  ------------------------------------------------------------------

**CEREMONIES**

  ---------------------------------------------------------------------
  **Field**       **Type**       **Notes**
  --------------- -------------- --------------------------------------
  ceremony_id     UUID PK        

  user_id         FK USERS       

  cycle_start     date           

  cycle_end       date           

  fired_at        timestamp      

  viewed_at       timestamp      
                  nullable       

  beats_payload   json           The 5 beats\' computed content,
                                 snapshot at fire time

  share_card_id   UUID nullable  If user generated a share card
  ---------------------------------------------------------------------

**10.3 Derived Views**

**KNOWLEDGE_BASE_VIEW** (per user)

Computed: union of (active declared interests) + (domains where user has
≥ 1 correct response from friend-mediated source).

Used by Daily Five generation and Knowledge page rendering.

**MASTERY_VIEW** (per user, per domain)

Computed: aggregate points per domain from QUESTION_RESPONSES, with
creator points joined in. Determines tier per §8.10.1.

**ALIGNMENT_VIEW** (per user-pair)

Computed per §8.9.2. Cached, recomputed on:

- New QUESTION_RESPONSES involving either user

- Friendship formation/removal

- Biweekly cycle (full recompute)

**10.4 Tables Dropped from v10.25**

- GROUPS, GROUP_MEMBERS

- GAMES, GAME_QUESTIONS, GAME_DAILY_ASSIGNMENTS

- SETUPS (game setup configurations)

- SIMILARITY_SHARES

- USER_INTEREST_PROFILES (replaced by DECLARED_INTERESTS +
  KNOWLEDGE_BASE_VIEW)

- PUBLIC_RUNS, PUBLIC_POOL_QUESTIONS

- STAR_VOTES (stars killed, thumbs-upped is now a flag on
  QUESTION_RESPONSES)

- EXPERT_INVITATIONS

**11. Monetization (Plus Tier)**

**11.1 Status: TBD**

Joshing Plus exists as a tier in the data model (USERS.tier) but its
feature set for v11.0 is **explicitly unresolved** and flagged in §19
Open Questions.

**11.2 Candidate Plus Features (for resolution)**

Options being considered:

  ---------------------------------------------------------------------------
  **Feature**            **Free**          **Plus**
  ---------------------- ----------------- ----------------------------------
  Declared interests     5                 5 (cap stays --- see note below)

  Question bank size     50                Unlimited

  Personal Rounds        3/day             Unlimited

  Send-to-friend daily   5                 10
  limit per recipient                      

  Past biweekly          Last 6            All
  ceremonies retention                     

  Knowledge page domain  Basic             Detailed (per-domain trend graphs,
  analytics                                predicted next tier date, etc.)

  Custom domains in      LLM-categorized   Free-text override always allowed
  declared interests     only              
  ---------------------------------------------------------------------------

**Note on declared interests cap:** I do not recommend allowing Plus to
break the 5-interest cap. The hard cap at 5 is a *design* decision, not
a *limitation*. Selling more interest slots would be selling away the
principle that grounds the rest of the model.

**11.3 Pricing**

TBD. Recommendation: 5/month or 40/year, paid via web (Stripe). No
in-app purchase complications since web-only.

**12. Technical Architecture**

**12.1 Stack**

Inherited from v10.25 with no major changes:

- **Frontend:** Next.js (web), responsive, mobile-optimized

- **Backend:** Node.js API server

- **Database:** Postgres

- **LLM:** External provider (Anthropic / OpenAI), abstracted behind an
  internal LLM service

- **SMS:** Twilio

- **Auth:** SMS OTP, JWT cookies for session

- **Hosting:** Cloud (existing infra)

- **Payments (Plus tier):** Stripe

**12.2 Daily Five Generation Architecture**

A daily job runs at \~11:50 EST to pre-generate Daily Fives for all
active users:

1.  For each active user, retrieve Knowledge base view + difficulty
    setting + most recent N questions

2.  Determine which domains to draw from (Random vs. Custom)

3.  Call LLM generation endpoint per question (5 calls per user,
    parallelizable)

4.  Validate each output per §9.2.3

5.  Persist as DAILY_FIVE_SESSIONS row + linked QUESTIONS rows

6.  At 12:00 EST, fire SMS to all users with successfully-generated
    sessions

Failure handling:

- Per-question failures: retry up to 3x, fall through to next domain

- Per-user failures (all domains failed): defer SMS, retry generation at
  12:30, then 1:00; if still failing, send a \"Today\'s Daily Five is
  delayed\" SMS

LLM call budget: 5 calls × N users = manageable. With expected MAU \<
10k at launch, this is cheap and parallelizable.

**12.3 Feed Architecture**

Feed items are written when triggers fire:

- Question shared to friends → for each friend, insert FEED_ITEMS row

- Question thumbs-upped → for each friend of the thumbs-upper, insert
  FEED_ITEMS row (or update existing for collapse)

- Question direct-sent → insert FEED_ITEMS row for recipient (state =
  active, source_type = direct_sent)

Feed retrieval:

- Query FEED_ITEMS WHERE recipient_user_id = X AND state = \'active\'
  ORDER BY (source_type = \'direct_sent\' DESC, source_event_at DESC)
  LIMIT 25

- Hydrate with question text, source friend display name, etc.

- Collapse thumbs_upped items with same question_id for display
  (\"Greg + 2 others\")

**Feed roll-off**

Items beyond the 25-item visible cap have state set to rolled_off by a
periodic job. They remain in the table for archive/audit purposes but
are not surfaced.

**12.4 Biweekly Ceremony Architecture**

A daily job runs at \~7:00 EST to identify users whose biweekly cycle
ends today:

1.  For each such user, compute the 5 beats\' content from
    QUESTION_RESPONSES, FRIENDSHIPS, ALIGNMENT_VIEW, etc.

2.  Run domain merge/split (§9.6) --- apply changes

3.  Snapshot beats payload into CEREMONIES.beats_payload

4.  Fire SMS

Beats payload is snapshotted (not computed live on view) so that the
ceremony tells a stable story even if the underlying data shifts over
the 7-day viewing window.

**12.5 SMS Architecture**

All SMS sent via Twilio. Categories:

- **Transactional** (OTP, daily five, friend-sent, ceremony) --- high
  deliverability, no rate constraints beyond Twilio\'s

- **Invitations** --- sent from the inviter\'s own phone via OS handoff
  (not from a Joshing number) --- see §7.2

Quiet hours enforcement: a queue defers non-OTP SMS to outside
quiet-hours-window per recipient.

**12.6 Performance Targets**

  -----------------------------------------------------
  **Surface**                     **Target**
  ------------------------------- ---------------------
  Home screen load                \< 1.5s

  Daily Five question reveal      \< 800ms

  Answer grading (deterministic)  \< 200ms

  Answer grading (LLM)            \< 2s

  Feed load                       \< 1s

  Knowledge page load             \< 1.5s

  Biweekly ceremony beat-to-beat  Smooth, no
  transition                      perceptible jank
  -----------------------------------------------------

**12.7 Migration from v10.25**

Two existing users (per §11 of the conversation). Migration is
effectively a clean slate:

- Preserve QUESTION_RESPONSES → mastery data is preserved

- Drop GROUPS, GAMES, all group-scoped tables

- Re-bootstrap each user through onboarding to declare 5 interests

- Migrate banked questions to USER_QUESTION_BANK

- Mastery tier and points carry forward

Estimated migration effort: trivial (2 users).

**13. Personal Performance Page (preserved from v10.25 §13)**

The personal performance page is the player\'s private analytics
surface. Visible only to the player themselves.

Contents:

- Daily Five completion rate (rolling 30 days)

- Average correct rate by difficulty

- Mastery progression chart (tier transitions over time)

- Top domains by points

- Catch-up activity

- Creator activity (questions written, answered by friends, creator
  points earned)

This page is **never** shared, exported, or shown to friends. It is the
player\'s own ledger.

**14. Out of Scope (v11.0)**

**14.1 Explicitly killed (will not return)**

- Group games, group seasons, group archives

- The three game setups (know_me, know_me_plus, open)

- Public Daily Game, Public Infinite Run

- Public question pool

- Game ending two-act ceremony, Game Summary, Creator\'s Summary

- Star voting, daily star budget

- Post-game similarity sharing

- Expert challenges

- AI Practice Mode

- \"Whose Questions\" picker on the Daily Five

**14.2 Deferred to future versions**

- Friend-of-friend introductions (Path 3 of friendship formation)

- Native iOS / Android apps

- International expansion beyond US (non-US phone numbers)

- Joshing Plus full feature definition (TBD per §11)

- Manual \"consolidate domain\" trigger from Knowledge page

- Per-friend Knowledge page filtering (\"show me what I know that Maya
  knows too\")

- Friend group constructs (e.g., \"music nerds\" sub-graph) ---
  explicitly NOT a return of groups; would be a tagging layer on the
  existing graph if revisited

- Push notifications (web push) --- SMS-only at launch

**14.3 Not products of this product**

- Real-time multiplayer

- Live trivia events

- Voice / video

- AR/VR

- AI chatbot companion

- Educational content / lesson plans

- Quiz authoring for institutions (schools, companies)

**15. Success Metrics**

**15.1 North Star**

**Daily Five completion rate among invited-and-onboarded users**,
measured as: % of users who completed at least one Daily Five session in
the past 7 days.

Target at 90 days post-launch: **\>50%.**

This metric captures the core question: do people return to the daily
ritual without prompting?

**15.2 Supporting Metrics**

**Ritual health**

- 7-day Daily Five completion rate (north star)

- 30-day Daily Five completion rate

- Average questions answered per session (target: \>4 of 5)

- Catch-up rate (% of missed questions answered within 7-day window)

**Social health**

- Feed engagement rate (% of users who tapped the Feed in past 7 days)

- Average Feed actions per user per week (Answer + Skip + Dismiss +
  Thumbs-up)

- Send-to-friend rate (sends per user per week, target: \>1)

- Friend invitation rate (invitations sent per user per month)

- Invitation acceptance rate (% of invitations accepted within 7 days,
  target: \>40%)

**Knowledge growth**

- Knowledge base growth velocity (new demonstrated domains per user per
  month)

- \% of users with \> 5 demonstrated domains at 30 days post-onboarding
  (indicator that friend-mediated expansion is working)

- Average domain count per active user at 90 days

**Ceremony engagement**

- Biweekly ceremony view rate (% of fired ceremonies viewed within 7
  days, target: \>60%)

- Ceremony share card creation rate (% of viewed ceremonies that
  resulted in a share card)

**Quality signals**

- Daily Five difficulty satisfaction (% of post-session \"about right\"
  responses, target: \>70%)

- LLM question rejection rate (% of generated questions that failed
  validation, target: \<5%)

- Average answer correctness rate per difficulty tier (validates
  calibration vs. §8.1.5 targets)

**15.3 Anti-Metrics**

We will **not** optimize for, surface, or report:

- Daily active users as a vanity number

- Time spent in app

- Notifications opened (treat as cost, not value)

- Streak length

- Total questions answered all-time

- Player rankings or leaderboards of any kind

**16. Open Questions**

The questions remaining for resolution before or shortly after launch:

**16.1 Plus tier feature set**

**Status:** explicitly TBD (§11). Need a coherent answer before charging
anyone money. Recommended timing: defer until 30 days post-launch when
we have signal on what power users actually want.

**16.2 Send-to-friend rate limit calibration**

**Status:** set to 5/day/recipient as starting value. Watch for spam
patterns or under-use; adjust empirically.

**16.3 Feed cap calibration**

**Status:** set to 25 items. Watch for \"always full\" or \"always
empty\" patterns; adjust empirically.

**16.4 Adaptive difficulty thresholds**

**Status:** set to 75% / 45% bumps with 0.5 sub-tier increments
(§9.2.4). Want to validate against actual session data; expect to tune.

**16.5 LLM question generation quality**

**Status:** the v10.25 difficulty problem is now a prompt-engineering
problem. Specific instructions are in §9.2.2, but real-world question
quality must be evaluated against player feedback in the first 30 days.

**16.6 Friend-of-friend introduction mechanic**

**Status:** deferred from v11.0. Worth revisiting at 90 days based on
graph density observations.

**16.7 SMS deliverability and cost at scale**

**Status:** Twilio pricing scales linearly. Need to monitor cost per
active user and consider batching strategies if SMS spend exceeds
budget.

**16.8 Domain merge aggressiveness**

**Status:** §9.6 says \"be aggressive on merges, conservative on
splits.\" The actual aggressiveness threshold needs tuning post-launch
based on player feedback (do consolidations feel right, or do players
complain that distinct domains were collapsed?).

**16.9 The \"Friend activity summary\" line on Home**

**Status:** included in §8.12.1 as *\"Maya and Greg played today.\"*
Worth a sanity check --- does it tip into surveillance, or is it a nice
ambient signal? Recommend launching with it, removing if it feels off.

**16.10 Ceremony beat omission rules**

**Status:** beats with no content are omitted (§8.8.4). For new players
whose first ceremony has many empty beats (e.g., no friends yet, no
discoveries, no creator activity), the ceremony may feel hollow.
Consider a \"first ceremony\" variant that explains the system rather
than recapping activity.

**17. Sample Questions (preserved from v10.25 §20)**

The 34 founding questions from v10.25 illustrate the tone, difficulty
register, and hyper-specificity that v11.0 should preserve in
LLM-generated content. They are kept in the spec as reference material
for prompt engineering.

\[Reference: v10.25 §20, full list preserved unchanged.\] The 34
founding questions below illustrate the tone, difficulty register, and
hyper-specificity that v11.0 LLM-generated content should aim for. They
are the canonical reference for prompt engineering on Daily Five
generation (§9.2) and for editorial calibration of question quality.

These questions share several traits worth naming explicitly:

- They are **factual**, with single correct answers (or tightly-bounded
  variants)

- They are **specific** --- they could not be mistaken for
  general-knowledge trivia

- They reward **having been there** --- having read the book, listened
  to the music, studied the period --- rather than rewarding recall of
  widely-shared facts

- The answers are **short and confirmable**, not essay-length

- Many include a **brief explainer** that adds texture without becoming
  pedantic

**Classical Music**

**1.** Who composed *Wozzeck*? *Alban Berg.*

Premiered in Berlin, 1925. Based on Georg Büchner\'s unfinished play.

**2.** In what year did Tchaikovsky complete his Sixth Symphony? *1893.*

The \"Pathétique.\" He conducted its premiere nine days before his
death.

**3.** What is the relationship between the prelude and fugue in Bach\'s
*Well-Tempered Clavier*? *Each prelude is paired with a fugue in the
same key; the collection cycles through all 24 major and minor keys,
twice (Books I and II).*

**4.** Who were the three composers of the Second Viennese School?
*Arnold Schoenberg, Alban Berg, and Anton Webern.*

**5.** What technique is Arvo Pärt most associated with developing?
*Tintinnabuli.*

A compositional method built around triadic voices and stepwise melodic
motion, introduced in 1976.

**6.** Which Mozart opera ends with the protagonist being dragged to
hell? *Don Giovanni.*

**7.** What is the subject construction in a fugue? *The principal
melodic theme (the \"subject\") is introduced by one voice, then
imitated by successive voices in different registers, often at the fifth
or octave.*

**Literature**

**8.** What is the central narrative innovation of *Ulysses*? *Each
episode parallels a book of the* Odyssey *while employing a distinct
narrative technique or \"style\" --- stream of consciousness, catechism,
parody, etc.*

**9.** In *The Waste Land*, who is Tiresias? *A blind prophet from Greek
mythology; in the poem, he is the unifying consciousness --- Eliot\'s
notes call him \"the most important personage.\"*

**10.** Who narrates *The Sound and the Fury*? *Four narrators across
four sections: Benjy, Quentin, Jason, and a third-person narrator
focused on Dilsey.*

**11.** What is the form of *In Memoriam A.H.H.*? *A long sequence of
lyrics in iambic tetrameter, written in ABBA quatrains --- the form is
now known as the \"In Memoriam stanza.\"*

**12.** Who is the dedicatee of Eliot\'s *The Waste Land*? *Ezra Pound
--- \"il miglior fabbro\" (\"the better craftsman\").*

**13.** What is the first line of *Middlemarch*? *\"Miss Brooke had that
kind of beauty which seems to be thrown into relief by poor dress.\"*

**Theater & Musicals**

**14.** Who wrote the libretto for *Sweeney Todd*? *Hugh Wheeler (book),
with lyrics by Stephen Sondheim.*

**15.** What is the source material for *Sunday in the Park with
George*? *Georges Seurat\'s painting* A Sunday Afternoon on the Island
of La Grande Jatte *(1884--86).*

**16.** In *Gilbert & Sullivan*\'s *The Mikado*, what is the location of
the action? *The fictional Japanese town of Titipu.*

**17.** What is the name of the Witch\'s daughter in *Into the Woods*?
*Rapunzel.*

**Film & Television**

**18.** Who directed *Aguirre, the Wrath of God*? *Werner Herzog.*

1972\. Filmed on location in the Peruvian Amazon with Klaus Kinski in
the title role.

**19.** What is the name of the starship in *Star Trek: The Next
Generation*? *USS Enterprise (NCC-1701-D).*

**20.** Which Weimar-era film established many conventions of German
Expressionist cinema? *The Cabinet of Dr. Caligari (1920), directed by
Robert Wiene.*

**21.** Who composed the score for *Vertigo*? *Bernard Herrmann.*

**History**

**22.** Who were Alexander the Great\'s three principal Successor
generals? *Ptolemy, Seleucus, and Antigonus.*

The Wars of the Diadochi (323--281 BCE) divided his empire among them
and their descendants.

**23.** In what year did the Hungarian Uprising begin and end? *Began
October 23, 1956; suppressed by Soviet forces by November 10, 1956.*

**24.** Who was the first U.S. President to be impeached? *Andrew
Johnson (1868).*

**25.** What was the official name of the agreement that ended the
Mexican-American War? *The Treaty of Guadalupe Hidalgo (1848).*

**26.** Which U.S. state was the last to be admitted to the Union?
*Hawaii (August 21, 1959).*

**27.** What was Operation Anthropoid? *The 1942 Czechoslovak resistance
operation to assassinate Reinhard Heydrich, the Nazi Reich Protector of
Bohemia and Moravia.*

**Visual Art**

**28.** Who painted *The Birth of Venus*? *Sandro Botticelli (c.
1484--1486).*

**29.** What is sfumato? *A painting technique developed by Leonardo da
Vinci involving the subtle blending of tones and colors without harsh
outlines, producing a smoky, atmospheric effect.*

Most famous in the Mona Lisa\'s facial modeling.

**30.** Who designed the dome of the Florence Cathedral? *Filippo
Brunelleschi (constructed 1420--1436).*

**Religion & Mythology**

**31.** What are the four canonical Gospels of the New Testament?
*Matthew, Mark, Luke, and John.*

**32.** Who is the Norse god of poetry? *Bragi.*

**33.** What is the central event of the festival of Passover? *The
Exodus --- the Israelites\' liberation from slavery in Egypt under
Moses.*

**Philosophy**

**34.** What is Kant\'s categorical imperative? *Roughly: \"Act only
according to that maxim by which you can at the same time will that it
should become a universal law.\" It is Kant\'s foundational principle of
moral duty, formulated in the* Groundwork of the Metaphysic of Morals
*(1785).*

**Notes for Prompt Engineering**

When generating Daily Five questions, the LLM should aim for:

1.  **Domain specificity** equivalent to the questions above --- not
    \"Music\" but \"Late Tchaikovsky,\" not \"Literature\" but \"James
    Joyce\'s Ulysses\"

2.  **Answer brevity** --- most answers are 1--10 words; brief
    explainers are 1--2 sentences

3.  **Factual grounding** --- every question must have an unambiguously
    correct answer

4.  **Calibration to engagement, not specialism** --- Normal-tier
    questions should test what a moderately-engaged player in the domain
    would know (e.g., \"Who composed Wozzeck?\" is Normal for someone in
    Classical Music; \"In what year did Berg orchestrate the Three
    Pieces, Op. 6?\" is Ridiculous)

5.  **Tone** --- direct, declarative, no padding, no quiz-show
    flourishes (\"Now here\'s a tough one!\"). The questions read like a
    thoughtful editor wrote them.

These 34 questions are the editorial north star. When in doubt about
whether an LLM-generated question fits Joshing, compare it to this set.

**18. Glossary**

  --------------------------------------------------------------------------
  **Term**             **Definition**
  -------------------- -----------------------------------------------------
  **Daily Five**       The 5 LLM-generated questions delivered each day at
                       noon EST

  **Feed**             The bounded reverse-chronological stream of
                       friend-curated questions

  **Knowledge base**   Union of declared interests + demonstrated domains;
                       drives Daily Five generation

  **Declared           Up to 5 hyper-specific domains the player chooses
  interests**          

  **Demonstrated       A domain added to Knowledge base via friend-mediated
  domain**             correct answer

  **Knowledge          The visual representation of a player\'s domain
  Portrait**           mastery (circles-by-category)

  **Send-to-friend**   The direct-send gesture; question pinned in
                       recipient\'s Feed

  **Biweekly           The 14-day cinematic reflection moment
  ceremony**           

  **Creator points**   Points earned when a friend correctly answers a
                       question you wrote

  **Mastery tiers**    Establishing → Familiar → Solid → Mastery

  **Personal Round**   Player-initiated 5-question deep-dive on a single
                       domain

  **Adaptive           Self-calibrating difficulty mode, targets \~60%
  difficulty**         correct rate
  --------------------------------------------------------------------------

**19. Document Status**

**Version 11.0** **Date:** April 2026 **Replaces:** v10.25 (April 2026)

**Status:** Draft for review. Pending resolutions on open questions in
§16, particularly Plus tier feature set (§11, §16.1).

**Next planned revision:** v11.1, post-launch, incorporating empirical
findings on Adaptive thresholds, Feed cap, Send-to-friend rate limits,
ceremony engagement, and any structural learnings from the first 30
days.

**End of Chunk 3. End of Joshing PRD v11.0.**

**Quick recap of what just happened**

The full v11.0 PRD is now drafted across the three chunks:

- **Chunk 1 (§1--7):** Executive Summary, Problem, Vision, Audience,
  Scope, User Stories, Auth & Onboarding

- **Chunk 2 (§8):** Feature specifications --- Daily Five, Feed,
  Send-to-Friend, Knowledge Base, Question Creation, Friend Profiles,
  Archive, Biweekly Ceremony, Alignment, Points & Mastery, SMS,
  Home/Nav, Design Principles

- **Chunk 3 (§9--19):** LLM Integration, Data Model, Monetization,
  Technical Architecture, Personal Performance, Out of Scope, Success
  Metrics, Open Questions, Sample Questions, Glossary, Doc Status

**A few things worth flagging on Chunk 3 specifically**

- **§10.2 Data model** --- I made specific schema choices (UUID PKs,
  soft deletes, JSON fields for variable-length data). Anything that
  doesn\'t match your engineering preferences, flag and I\'ll adjust.

- **§11 Plus tier** --- left as TBD with candidate features. The \"do
  not break the 5-interest cap\" recommendation is strong from me; want
  to confirm.

- **§12.2 Daily Five generation architecture** --- pre-generation at
  11:50 EST is one approach. Alternative: lazy generation on session
  open. Pre-gen is more reliable; lazy is cheaper if many users skip
  days. Worth deciding.

- **§15.3 Anti-metrics** --- explicit list of what we *won\'t* track.
  Worth reviewing --- is there anything missing that you want explicitly
  disowned?

- **§16.10 First-ceremony hollowness** --- flagged a real risk. New
  players\' first ceremony may have many omitted beats. Worth a
  follow-up design moment.

**What I\'d recommend as next steps**

1.  **You read all three chunks end-to-end as a single document.** The
    chunked drafting was for reactivity; the document is meant to be
    read as one coherent thing.

2.  **Mark anything that needs a substantive change.** I\'ll do a
    v11.0.1 pass to incorporate.

3.  **Resolve §11 (Plus tier) before any monetization work begins.** Not
    blocking for engineering on the core product.

4.  **Lock §16.9 (Friend activity line) and §16.10 (first ceremony)
    before design starts on Home and Ceremony.**

5.  **The 34 founding questions should be properly inlined in §17**
    rather than referenced --- I left them as a pointer to v10.25, but
    they should live in this document so it\'s self-contained. Want me
    to inline them in a follow-up?


§21 — Migration Strategy
21.1 Overview
The v10.25 codebase is a working Next.js + Prisma + Postgres application. v11.0 is a new Next.js + Drizzle + Postgres application scaffolded separately. The migration is a selective extraction, not a refactor in place.

Do not attempt to modify the v10.25 codebase into v11.0. The group/game/season machinery is too deeply embedded. Instead: extract what works, rebuild the rest.

Salvage directory: /app in the v10.25 repo is the source. The new project is the destination. Nothing moves automatically.

21.2 What to Salvage
Carry forward with direct copy (then adapt):

v10.25 source    v11.0 destination    Notes
app/src/lib/auth/    src/server/auth/    OTP logic, session cookies — near-identical
app/src/lib/sms.ts    src/server/sms.ts    Twilio fetch pattern — copy directly
app/src/lib/llm.ts    src/server/llm/    Extract: grading, categorization, answer suggestion, factual explanation
app/src/components/play/GameplayChat.tsx    src/components/play/GameplayChat.tsx    Core chat interface — carry forward, strip group refs
app/src/components/play/SessionCloseMessage.tsx    src/components/play/SessionCloseMessage.tsx    Carry forward unchanged
app/src/components/play/GeometricProgress.tsx    src/components/play/GeometricProgress.tsx    Carry forward unchanged
app/src/components/knowledge/ (all)    src/components/knowledge/    All knowledge display components
app/src/components/QuestionForm.tsx    src/components/QuestionForm.tsx    LLM suggestion intact
app/src/components/QuestionBankPicker.tsx    src/components/QuestionBankPicker.tsx    Carry forward
app/src/components/QuickAddQuestionModal.tsx    src/components/QuickAddQuestionModal.tsx    Carry forward
app/src/components/share/SeasonCardV2.tsx    src/components/share/ShareCard.tsx    Rename, adapt for v11.0
app/src/lib/mastery/ (all)    src/server/mastery/    Tiers, awards, ceremony — carry forward
app/src/lib/games/grading.ts    src/server/grading.ts    Answer grading logic
app/src/lib/games/answer-state.ts    src/server/answer-state.ts    answer_state enum logic
app/src/lib/games/adaptive-difficulty.ts    src/server/adaptive-difficulty.ts    Adaptive level logic
app/src/lib/play/catch-up-copy.ts    src/server/play/catch-up-copy.ts    Carry forward
app/src/lib/profile/ (all)    src/server/profile/    Knowledge graph, portrait — carry forward
app/src/components/ceremony/PersonalRecordBeat.tsx    src/components/ceremony/    Adapt for biweekly
app/src/components/ceremony/ShareBeat.tsx    src/components/ceremony/    Carry forward
app/src/lib/daily/generate-questions.ts    src/server/daily/generate-questions.ts    Core LLM generation — carry forward
app/src/lib/daily/mastery.ts    src/server/daily/mastery.ts    Carry forward
app/src/app/components/games/game-details-mode-sections.tsx    src/components/games/game-details-mode-sections.tsx    Adapt for Joshing Game summary
app/src/app/components/games/interpretive-sections.tsx    src/components/games/interpretive-sections.tsx    Adapt for Joshing Game summary
Do not carry forward:

app/src/lib/games/ (all group/season machinery)
app/src/app/groups/ (all group pages)
app/src/app/api/groups/ (all group API routes)
app/src/lib/games/summary.ts (rewrite for Joshing Game)
app/src/components/ceremony/ (rewrite for biweekly per-player)
app/src/lib/ceremony/ (rewrite for biweekly per-player)
app/src/app/api/games/ (group-scoped — drop)
All challenge routes and components
21.3 Build Phases and Prompts
Run these prompts in order in Claude Code (Composer mode). Each prompt assumes the previous phase is complete and committed.
