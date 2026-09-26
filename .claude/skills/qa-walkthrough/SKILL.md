---
name: qa-walkthrough
description: Full exploratory QA walkthrough of the live Joshing app in Chrome (auth, gameplay, friends, knowledge, invites), judged against Joshing's product principles, ending with a self-contained HTML + PDF report and deletion of test accounts B and C. Only run when the user types /qa-walkthrough.
argument-hint: (optional) extra focus or notes for this run, e.g. "re-check PR #1713 blocking fixes"
disable-model-invocation: true
---

# Joshing QA walkthrough

Extra focus for this run (may be empty): $ARGUMENTS

## Before you start
- Load the claude-in-chrome skill and its browser tools (one ToolSearch call), then call tabs_context_mcp and open a NEW tab.
- Target: https://joshing-11.vercel.app (production). Browser automation against localhost is blocked, so do not test a local dev server.
- Save outputs to `docs/reports/` in this repo as `YYYY-MM-DD-joshing-qa-report.html` and `YYYY-MM-DD-joshing-qa-report.pdf` (today's date). Make the PDF from the HTML with Playwright (Edge headless silently fails here).
- If the browser tools fail 2–3 times in a row, stop and tell the user instead of looping.

## The brief

You're testing Joshing, a social trivia app, in this Chrome tab. Do an exhaustive, systematic walkthrough and log everything: bugs, confusing UX, broken links, console errors, inconsistent copy, and anything that violates these product principles:
- No streaks, leaderboards, or coercive mechanics (guilt, urgency, streak pressure).
- Wrong answers should feel like connection moments, not failures.
- Color alone never carries meaning; there's always a second cue (text, shape, icon).
- Grading "fails toward the player": ambiguous or partly right answers should be marked correct.

### Accounts (every account uses OTP 000000)
- A (main, KEEP): 5552222222 (Duo Prova). Never delete this account.
- B (second, DELETE AT END): 5553333333. It may already exist from earlier testing. If it doesn't exist (a login shows "Joshing is invite-only"), create it by redeeming an invite from A, and treat that as extra fresh-signup coverage.
- C (fresh signup, DELETE AT END): 5554444444. Joshing is invite-only, so C must join through an invite from A. If C already exists from a previous run, note that, then delete it first (see Final cleanup) so you can sign it up fresh.
- If 5554444444 won't accept 000000 ("Unable to send code"), stop the C-dependent tests, mark them UNTESTED, and say so in the report.
- Use separate Chrome windows so two accounts can be signed in at the same time.

### Viewport
Joshing is used mostly on phones. Do the whole walkthrough at phone size (about 390×844). At the end, do one short pass at desktop width and note only what differs.

### Step 0: record and reset the starting state (before any testing)
For A and B (if B exists), write down and screenshot: friends list, pending requests (in and out), Blocked people list, invite links, "People you invited", today's round progress, and privacy toggles.
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

**3. Friend system (starting from the baseline)**
Do these in order, and screenshot both A's and B's view after each step:
1. A searches for B by handle and by phone.
2. A sends B a request WITH a note; B checks that the note appears.
3. B declines. A tries to re-send (should be quietly suppressed, without revealing the decline).
4. B sends A a request; A accepts. Check every surface shows them as friends: both friends lists, search, profiles, "People you invited", and the invite-by-phone flow.
5. A blocks B. Check every one of those surfaces again, on BOTH sides, including B's bonus questions ("from …'s world").
6. While blocked, try every way to reconnect in both directions: request, invite-by-phone, invite link.
7. A unblocks B. Are they friends again? (They should NOT be.)
Also check: search rate limiting, mutual-friend suggestions (where they surface), friend profiles (overlap, shared knowledge by category), and whether any stranger's name or activity reaches a feed without consent.

**4. Knowledge / profile**
- Profile page: knowledge portrait and category territory. Do the numbers add up (e.g. "+3 more" vs. "across N territories")?
- Declare an interest. Does it visibly change which questions come next?
- Bubble/map views and the mastery and frequency legends. Can each level be told apart without color?
- Where do user-added topics land in the taxonomy?

**5. Invite system**
- A creates an invite link.
- Redeem it as C (fresh) and as B (existing, from the baseline). Does friendship form? Is there a confirmation?
- Redeem as B while B is blocked by A.
- Invalid, expired, and already-used links.
- Co-invitee auto-friending: B and C both redeem the SAME link from A. Do B and C end up friends with each other? Record what happens.

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
3. One section per area. Screenshots sit next to the flow or state they show, each captioned with time, account, and URL.
4. Prioritized issue list (Critical / Should-fix / Nice-to-have). Each item has an ID, repro steps, times, reproduced count, and screenshot IDs. Keep "Possible cause" separate.
5. "Questions for Josh": deliberate-looking behavior you think is worth rethinking, with your reasoning.
6. Untested: what you couldn't test, and exactly what would unblock it.
7. Principle audit: one row per principle with a verdict and evidence.
8. Suggestions for improvement: concrete UX/product recommendations, not just bug fixes.
9. Cleanup: what was deleted, when, how it was checked, and any leftovers.
10. A timeline appendix: every action in order with its time, so it can be matched against the database.

Save it as ONE self-contained HTML file with screenshots embedded inside it (base64), plus a PDF of that same file. Don't make a separate text-only edition. Tell the user when both are ready and where they're saved, and confirm which test accounts still exist.
