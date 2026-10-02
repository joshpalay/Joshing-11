---
name: qa-walkthrough
description: Full exploratory QA walkthrough of the live Joshing app at phone size (auth, gameplay, friends, knowledge, invites, design system), judged against Joshing's product principles, ending with a self-contained HTML + PDF report and deletion of test accounts B and C. Only run when the user types /qa-walkthrough.
argument-hint: (optional) extra focus or notes for this run, e.g. "re-check PR #1713 blocking fixes"
disable-model-invocation: true
---

# Joshing QA walkthrough

Extra focus for this run (may be empty): $ARGUMENTS

## Before you start
- **Ask for approvals in ONE question, up front** (safety checks block irreversible actions mid-run otherwise): (a) delete accounts B and C at the end; (b) if C already exists, delete it first so it can sign up fresh; (c) if A is at the 3-invite-link cap, delete one link so "A creates a link" can be tested. Only do what was approved; mark the rest UNTESTED.
- **Browser: use the Playwright harness in `scripts/qa/`.** Chrome via claude-in-chrome can't resize to phone width on this machine and its tab runs hidden and throttled (three runs in a row). The harness runs three headless 390×844 iPhone-style browsers, one per account, all signed in at once, and logs console errors, 4xx/5xx responses and dialogs per account.
  - Set `QA_DIR` to a folder in the session scratchpad (the profiles hold live session cookies, so never put them in the repo), then start `node scripts/qa/server.cjs` in the background for the whole session.
  - Drive an account with `bash scripts/qa/run.sh <A|B|C>` and a JS snippet on stdin (quoted heredoc). Helpers: `h.go`, `h.text`, `h.shot(id, caption, {full})`, `h.click`, `h.api`, `h.login(phone)`, `h.log(msg)` (goes to the timeline), plus `answer()`, `btns()`, `dots()` and `designAudit()` from `scripts/qa/lib.js`. Use the real login screen once per account for coverage, and `h.login` after that.
  - Many buttons have an aria-label that differs from their text (Decline is "Decline friend request from X", topic circles are "View <topic> details", frequency options are `role=radio`). If a click times out, look up the real label before retrying.
  - Desktop pass: `node scripts/qa/desktop.cjs` (reuses A's session at 1280×800).
  - Confirm causes with read-only queries: `node scripts/qa/ro-query.cjs` (every statement runs inside `BEGIN READ ONLY`).
  - Stop the server at the end.
- Target: https://joshing-11.vercel.app (production). Browser automation against localhost is blocked, so do not test a local dev server.
- **Plan for the 1 PM ET round rollover.** Next-round effects (a new topic showing up, a Never topic staying out of the five, catch-up and bonuses, a blocked friend's bonus, a declared interest changing the questions) can only be seen after 1 PM ET. Either run across 1 PM, or finish the run and come back after 1 PM for a short "next round" pass before writing the report. Record the topic, level and time of every change so it can be matched.
- Save outputs to `docs/reports/` in this repo as `YYYY-MM-DD-joshing-qa-report.html` and `YYYY-MM-DD-joshing-qa-report.pdf` (today's date). Write the report as a template and build it with `python scripts/qa/build-report.py <template> <out.html> --style-from <previous report>` (it embeds the screenshots and the timeline; see the script header). Make the PDF from the HTML with Playwright (Edge headless silently fails here).
- If the browser tools fail 2–3 times in a row, stop and tell the user instead of looping.

## The brief

You're testing Joshing, a social trivia app, in production. Do an exhaustive, systematic walkthrough and log everything: bugs, confusing UX, broken links, console errors, inconsistent copy, and anything that violates these product principles:
- No streaks, leaderboards, or coercive mechanics (guilt, urgency, streak pressure).
- Wrong answers should feel like connection moments, not failures.
- Color alone never carries meaning; there's always a second cue (text, shape, icon).
- Grading "fails toward the player": ambiguous or partly right answers should be marked correct.

### Accounts (every account uses OTP 000000)
- A (main, KEEP): 5552222222 (Duo Prova). Never delete this account.
- B (second, DELETE AT END): 5553333333. It may already exist from earlier testing. If it doesn't exist (a login shows "Joshing is invite-only"), create it by redeeming an invite from A, and treat that as extra fresh-signup coverage.
- C (fresh signup, DELETE AT END): 5554444444. Joshing is invite-only, so C must join through an invite from A. If C already exists from a previous run, note that, then delete it first (see Final cleanup) so you can sign it up fresh.
- If 5554444444 won't accept 000000 ("Unable to send code"), stop the C-dependent tests, mark them UNTESTED, and say so in the report.
- The harness keeps A, B and C signed in at the same time in separate browser profiles.

### Viewport
Joshing is used mostly on phones. Do the whole walkthrough at phone size (about 390×844). At the end, do one short pass at desktop width and note only what differs.

### Step 0: record and reset the starting state (before any testing)
For A and B (if B exists), write down and screenshot: friends list, pending requests (in and out), Blocked people list, invite links, "People you invited", today's round progress, privacy toggles, and every topic with its frequency level (from "Customize" / `/daily/setup`).
Then reset to this baseline and screenshot it again:
- A and B are NOT friends, NOT blocked, and have no pending requests either way.
If anything won't reset (for example, unblocking brings a friendship back), that is a finding. Log it and continue from wherever it lands.
Put both the "as found" and the "baseline" states in the report.

### Logging rules (apply to every finding)
- Give every action a clock time (HH:MM, with timezone), the account, and the URL. Example: "14:32 ET · A · /friends · pressed Block on Trio Third."
- Separate WHAT YOU SAW from WHAT YOU THINK CAUSED IT. Put guesses under a "Possible cause" label, never inside the finding itself.
- Before rating anything Critical, reproduce it a second time from a known state. Note "reproduced 2/2" or "seen once."
- Quote on-screen copy exactly, in quotes.
- Check the browser console on every screen, and record errors with their time.
- **Confirm the cause of every Should-fix and Critical finding before the report goes out.** Read the code path and, where useful, run a read-only DB query. Write what you confirmed under "Possible cause" with the file/line or query result; if you couldn't confirm it, say "unconfirmed guess". (On 2026-10-01, two of five first-draft causes turned out partly wrong.)

### Re-check past fixes (do these during the matching area)
Each was fixed after an earlier run. Confirm it still holds and say so in the report.
- "Not now" on "Add <topic> to your topics?" does NOT add the topic (fixed after 2026-09-29).
- A catch-up question appealed in an earlier attempt can be appealed again on a later attempt, with no "already been rechecked" (2026-10-01 S2).
- A topic stays in the category the player chose. Check that A's Renaissance Florence shows under History and Final Fantasy under Pop Culture, before and after playing (2026-10-01 S5).
- Removing a topic says the points are kept, and re-adding it says "… is back on your map — the points you'd earned are still there." (2026-10-01 S6).
- After friend, then unfriend or block, then unblock, then friend again, the feed shows ONE "<name> is now a friend" row, and a former friend's activity ("played their first five questions") disappears once you're no longer friends (2026-10-01 S1).
- "Never show this question" works (fixed after 2026-09-26) — including after the next 1 PM: the hidden question must NOT come back in catch-up (2026-10-01 run 2, C1).
- A topic you only answered in (a wrong From Friends answer, or a bonus where you chose "Not now") does NOT show on Manage your topics, the knowledge circles, or "Recently expanding". Test with an account that has never removed that topic: a removed topic hides the result (2026-10-01 run 2).
- On a played From Friends card on home, the airplane's sheet opens ABOVE the bottom nav and the + button, and "Text it" can be tapped; same for "Send in Joshing" (2026-10-01 run 2).
- After "Argue your point" is accepted in catch-up, the card turns correct: no "Not this time", no "+0 POINTS" (2026-10-01 run 2).
- The key under the knowledge circles reads "Numbers inside circles = questions answered in each topic" (2026-10-01 run 2).
- Forwarding a friend's question: the receiver sees "<sender> sent you this", not "a question they wrote" (2026-10-01 run 2).
- "Text it" carries the sender's own invite link (the one whose topics match the question, else their first), not the bare site URL (2026-10-01 run 2).
Add to this list whenever a run's findings get fixed.

### Known deliberate decisions: do NOT file these as bugs
If you think one hurts the experience, list it under "Questions for Josh" with your reasoning instead.
- Reactions were REMOVED on purpose. Don't look for a way to react on wrong answers, and don't report their absence.
- "Maid Acasa" is Joshing's own question-writing bot, not a real person. It is deliberately NOT marked as a bot (Josh, 2026-09-26). Don't treat its name as a privacy leak, and don't ask again whether players can tell.
- "Show me the answer" counts as a wrong answer (red / "Not this time") on purpose (Josh, 2026-09-26).
- Test accounts playing may send notifications to real users (niche-match, author notices). That's accepted for now (Josh, 2026-09-26).
- Players never see anonymous activity ("Someone …"). A feed row that can't name a real, identifiable person is a bug (Josh, 2026-09-26).
- Partly-right answers can be graded wrong (e.g. "the Queen" for the Queen of the Night) even when the feedback says they were close. Accepted as-is (Josh, 2026-09-26).
- Right/wrong dots on the round, summary and home differ by color only. Accepted as-is (Josh, 2026-09-26).
- "Let people I've never met discover me" is ON by default on purpose (test phase).
- An unviewed weekly ceremony is shown on the way to the daily summary, then continues to the summary. Check that the button copy is honest about it.
- "Play missed questions" can replay TODAY's misses right away. That's intended; check only that labels and dates are right.
- Friend = mutual. Both sides must accept (except invite links, where the invite counts as consent).
- Some topics have thin question banks on purpose (questions are generated on demand). Don't suggest "add more content" as a fix.
- The daily summary shows every question as a full card on purpose. Don't propose collapsing it.
- Developer tools are admin-only. If A can't see them, that's expected.
- The send airplane on Lately / Activity cards only appears on questions you already know (answered right or wrong, or wrote). No airplane on an unplayed card is intended (Josh, 2026-10-01).
- A question you WROTE counts as known, so its answer and airplane show on "<friend> answered your question" cards (2026-10-01).
- "Text it" goes through your phone's own Messages app (you pick the person there), not Joshing's own texts. On a computer it copies the text instead (2026-10-01). Its link is the sender's own invite link, so whoever signs up through it becomes the sender's friend; with no links it falls back to the site URL (2026-10-02).
- Right after answering a From Friends question wrong, "Text it" can go out without the answer until the page is reloaded. Accepted (2026-10-01).
- Still owed: a real-phone check of "Text it" on iPhone and on Android. Browser automation can't open Messages, so list it under "Questions for Josh" until he confirms it.

### Test areas: go deep on each; don't skim

**1. Onboarding & auth**
- Fresh signup with C (via A's invite): OTP entry, wrong OTP, resend, expired code.
- Signing in with an uninvited number should show the invite-only message. Check it's visible without scrolling.
- Returning-user login for A and B.
- Profile setup as C: name, avatar, interests. Note what's required vs. skippable, and whether disabled buttons explain why.

**2. Gameplay**
- Play a full Daily Five end to end: question flow, answering, grading feedback.
- For grading, try at least:
  - one clearly correct answer
  - one clearly wrong answer
  - one typo or near-miss
  - one ambiguous answer
  - one PARTLY right answer to a multi-part question
  Record the exact question, your exact answer, and the verdict.
- Skip at least one question, and use "Not for me" and "Show me the answer". Watch the progress dots after each one.
- Bonus (+2) questions: confirm they're additive. They must not fill the regular five dots or change "x of 5". Note the ORDER bonuses were served in.
- After the round, compare the home card, the summary, and the round screen. Do the answered counts, dots, and "next five at…" times all agree?
- Missed-question returns and catch-up: check the "From …" labels against the real day, and note any point discounts.
- Weekly ceremony, if reachable: date range vs. "Seven days", and what "mastered" actually means.
- The "Lately" feed and the daily summary.
- Answers and the send airplane on Lately / Activity / From Friends cards:
  - Open every kind of question card you can find ("<friend> answered your question", "You came through on …", "You and <friend> keep landing in the same place", niche-match, a played From Friends card). On a question A has already answered (right or wrong) or wrote, the answer shows under it with an "ANSWER" label.
  - On a question A has NOT played, there is no answer and no airplane. Any answer or airplane on an unplayed question is a Critical spoiler bug.
  - Tap the airplane: a menu offers "Send in Joshing" and "Text it". "Send in Joshing" opens the friend picker, and the question it sends must NOT carry the answer. Check B's received copy.
  - "Text it": in a desktop browser it copies the text and shows "Copied — paste it in a text ✓". Paste it somewhere and record it exactly: "Did you know?", the question, the answer, then "Play on Joshing: <link>". With a phone user agent it tries to open Messages (an `sms:` link). Don't follow it out of the page; just note that it fired.
  - Answer a From Friends question WRONG, then text it before reloading. The text may have no answer (see deliberate decisions). Reload and confirm the answer is then included.

**3. Friend system (starting from the baseline)**
Do these in order, and screenshot both A's and B's view after each step:
1. A searches for B by handle and by phone.
2. A sends B a request WITH a note; B checks that the note appears.
3. B declines. A tries to re-send (should be quietly suppressed, without revealing the decline).
4. B sends A a request; A accepts. Check every surface shows them as friends: both friends lists, search, profiles, "People you invited", and the invite-by-phone flow.
5. A blocks B. Check every one of those surfaces again, on BOTH sides, including B's bonus questions ("from …'s world").
6. While blocked, try every way to reconnect in both directions: request, invite-by-phone, invite link.
7. A unblocks B. Are they friends again? (They should NOT be.)
Also check: search rate limiting, mutual-friend suggestions (turn on "Suggest me through mutual friends" for B and C first: it's OFF by default, so suggestions never appear otherwise; then look on Find Friends), friend profiles (overlap, shared knowledge by category), and whether any stranger's name or activity reaches a feed without consent.

**4. Knowledge / profile**
- Profile page: knowledge portrait and category territory. Do the numbers add up (e.g. "+3 more" vs. "across N territories")?
- Declare an interest. Does it visibly change which questions come next?
- Bubble/map views and the mastery and frequency legends. Can each level be told apart without color?
- Where do user-added topics land in the taxonomy?
- Add and remove topics (home card "Customize" → `/daily/setup`, and any other place a topic can be added or dropped). For each:
  - Add a brand-new topic. Is there a confirmation? Does it show up on the profile, the knowledge page, and the setup screen? Does it show up in the next five?
  - Remove a topic. Is it gone everywhere, or does it linger (profile "building around…" line, knowledge map, invite-link topics, bonus questions)? Is there a way to undo, and is the copy clear about what removing does?
  - Re-add the topic you removed. Does its old progress come back or start from zero, and does the app say which?
- Change how often a topic comes up (the frequency levels: Often → Sometimes → Blue Moon → Never; "Never" is the app's name for resting). For each change:
  - Move a topic between levels. Does it save, and does the change survive a page reload?
  - Does the new level show the same way everywhere it appears (setup screen, knowledge page, legends)? Can the levels be told apart without color?
  - Set a topic to Never. Does it stop appearing in the five, catch-up, missed-question returns and bonus questions? (Needs the next round: see the 1 PM rollover note.)
  - Record the topic, the old and new level, and the time, so it can be matched against the next round.
- Put A's topics and frequencies back to how they were at the start (note them in Step 0), and say in the report if anything wouldn't go back.

**5. Invite system**
- A creates an invite link (needs a free slot: see the up-front approvals. If not approved, have B create one instead and say so).
- Redeem it as C (fresh) and as B (existing, from the baseline). Does friendship form? Is there a confirmation?
- Redeem as B while B is blocked by A.
- Invalid, expired, and already-used links.
- Co-invitee auto-friending: B and C both redeem the SAME link from A. Do B and C end up friends with each other? Record what happens.

**6. Design system review** (every screen visited, at phone size and in the desktop pass)
Judge against `_docs/DESIGN-SYSTEM.md` (the canon; if it and `globals.css` disagree, the CSS is right), `_docs/STYLE-GUIDE-TYPE.md` and `_docs/STYLE-GUIDE-COLOR.md`.
- On each main screen (home, round, summary, catch-up, friends, profile, knowledge, setup, Lately, invite pages, login and onboarding), run `designAudit()` and take a screenshot. It flags:
  - buttons or links side by side in a row whose tops, bottoms or heights differ (misaligned buttons)
  - tap targets under the 44px touch floor
  - text spilling out or truncated, and sideways page scroll
  - controls hidden under the fixed header or nav
  - fonts outside Josefin Sans / Cormorant Garamond / Montserrat
  These are hints, not verdicts. Confirm each one on the screenshot (zoom in) before filing it, and don't file intentional inline text links (canon §3.7) as small targets.
- Also look for, by eye:
  - buttons that don't follow the button tree (primary / ghost / danger / icon / tab / list-row / inline text action / FAB): wrong height, radius, weight or color for their role, or two primary buttons on one screen
  - cards, chips and badges that don't match their recipes (radius, border, shadow; chips have no shadow)
  - uneven spacing between sibling elements, uneven gutters, things not lining up with the column edge
  - overlap: floating panels, the FAB or toasts covering content
  - color used off its job (grading colors used decoratively, category colors carrying meaning alone)
- File each with the screen, the element (quoted text), what's off and by how much (px when you can measure), the canon rule it breaks (§ number), and a zoomed screenshot.

For each area, note:
- what worked
- bugs, with exact repro steps and times
- habit-machine copy (streak pressure, guilt, urgency)
- places where color alone carries meaning

### Final cleanup (do this LAST, after every test and screenshot is captured)
1. Sign in as B → own profile → "Delete account" → type DELETE → confirm. Screenshot the confirm step and the screen you land on. Note the time.
2. Do the same for C.
3. Check that it worked:
   - Signing in again as 5553333333 and as 5554444444 should show the invite-only message, not an existing account.
   - As A: B and C are gone from Friends, search, Blocked people, and pending requests. Note what "People you invited" shows for them.
   - Log any leftovers (names, cards, requests, bonus attributions still pointing at B or C) as findings.
4. NEVER delete A (5552222222). If you're unsure which account a window is signed in as, check the profile name and phone before pressing Delete.
If a deletion fails or leaves traces, report it as a finding with times, and say clearly in the summary which accounts still exist.

### Final deliverable
A detailed report with these sections:
1. Short overall summary.
2. Starting state (as found) and baseline, with screenshots.
3. One section per area (including the design system review and a "re-checked past fixes" table). Screenshots sit next to the flow or state they show, each captioned with time, account, and URL.
4. Prioritized issue list (Critical / Should-fix / Nice-to-have). Each item has an ID, repro steps, times, reproduced count, and screenshot IDs. Keep "Possible cause" separate.
5. "Questions for Josh": deliberate-looking behavior you think is worth rethinking, with your reasoning.
6. Untested: what you couldn't test, and exactly what would unblock it.
7. Principle audit: one row per principle with a verdict and evidence.
8. Suggestions for improvement: concrete UX/product recommendations, not just bug fixes.
9. Cleanup: what was deleted, when, how it was checked, and any leftovers.
10. A timeline appendix: every action in order with its time, so it can be matched against the database.

Save it as ONE self-contained HTML file with screenshots embedded inside it (base64), plus a PDF of that same file. Don't make a separate text-only edition. Tell the user when both are ready and where they're saved, and confirm which test accounts still exist.
