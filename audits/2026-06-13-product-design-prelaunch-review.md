# Joshing — Product Design Pre-Launch Review

**Date uploaded:** 2026-06-13
**Author framing:** External review, written as "acting VP of Product Design hired one month before launch."
**Method:** Walked every path, triggered states across fresh accounts (Alex, Blake, Testing), played daily questions, bonus rounds, question authoring, knowledge map, friend discovery, catch-up flows, profiles. ~150 screenshots, issues ranked by impact/effort/strategic importance.

> Saved verbatim from the uploaded review so it is not lost. Live status of each item is tracked separately in `audits/AUDIT-TRACKER.md` (do not edit status here — track it there).

## Overview

Joshing is a social learning game built around a Daily Five quiz that encourages friends to discover one another's interests and expand shared knowledge. The design pays tribute to printed newspapers: creamy backgrounds, serif typography, refined icons — a warm, premium feel. Key surfaces: Home, Daily Five, Questions, Knowledge, Friends, Profile; circles and cards visualise progress, mastery and curiosity.

## Top 25 Improvements

| # | Issue & Evidence | Why it Matters | Recommendation | Effort | Impact |
|---|---|---|---|---|---|
| 1 | **Developer tools visible to all users:** profile page exposes *Create test game, Reset session, Trigger noon reset, View staging flags, Points diagnostic*. | Exposing debug tools undermines trust, invites misconfiguration, reveals internals; users might erase data or assume the product isn't finished. | Hide dev tools behind an admin flag. Only authorized testers should see them. Replace with an "About"/"Support" section. | Low | High |
| 2 | **Intermittent 404 on initial load:** root URL occasionally returned a 404 before redirecting to Home during sign-in. | Nothing shatters first impression more than a missing page; signals instability. | Ensure app root always routes to a valid landing page. Friendly loading indicator instead of hard 404. | Medium | High |
| 3 | **"Show me the answer" duplication:** small text link reveals a full-size button with the same label before finally showing the answer. | Double action feels like a bug; confuses the user. | One clear toggle: clicking the small link reveals the answer immediately. Remove the intermediate button. | Low | Medium |
| 4 | **Auto-generated tagline misrepresents new users:** after signup, Alex's tagline auto-referenced "Talking Heads discography & New York No Wave / Art-Rock scene." | Random subculture interests risk alienating users or feeling like a hack. | Ask for a short tagline at onboarding or allow skip. Neutral placeholder until they play. | Medium | Medium |
| 5 | **Question rewrite suggestions contain "Use this" artefact:** review step suggests "Use this Which American city…". | Robotic, unpolished; off-tone. | Clean the copy: present suggestions as fully formed questions. | Low | Medium |
| 6 | **Unclear progress after saving a question:** button changes to "Saving…" with no spinner or success message. | Lack of feedback → double submissions / frustration. | Brief toast ("Your question is live!"); disable button until complete. | Low | Medium |
| 7 | **Gear icon on Today's Five card does nothing.** | Dead controls confuse and hint at missing features. | Remove the gear or implement a settings menu (e.g., daily reminder toggle). | Low | Low |
| 8 | **"Show me the answer" consumes a missed question with no confirmation** in catch-up flows. | Users may unintentionally lose the chance to answer; feels unfair. | Confirmation prompt explaining reveal counts as a pass. | Low | Medium |
| 9 | **Privacy toggles lack context:** Private/Friends/Public with no description of what each section (Knowledge base, Questions, Friends) means. | Users may overshare or hide everything out of caution. | Brief descriptions/tooltips per privacy area. | Low | Medium |
| 10 | **"Establishing" label unclear:** new questions show a green *Establishing* label — difficulty? popularity? category? | Ambiguous labels hinder comprehension, degrade trust. | Rename to human label ("In review" / "Just published") + tooltip. | Low | Low |
| 11 | **Confusing card-colour switcher:** "Card Color" toggle cycles "Cream page"/"Warm cream" with no explanation. | Users may think they alter all cards or break contrast. | Rename to "Theme"/"Background", show preview swatches; consider moving to settings. | Medium | Low |
| 12 | **Profile editing hidden behind preview:** no direct way to edit handle/tagline except clicking the tagline (not obviously editable). | Discoverability issue reduces customization. | Explicit "Edit profile" button + clear editing modal. | Low | Medium |
| 13 | **Lengthy explanation fields scroll within a small text area** in the question composer. | Increases cognitive load; discourages detailed explanations. | Expand field height dynamically or full-screen composer. | Low | Low |
| 14 | **Friend list lacks actionable affordances:** names + interests but no quick actions (message, play, unfriend). | Social features feel under-developed, purely informational. | Per-friend icons for Play / Invite / Message; metrics like streak count. | Medium | Medium |
| 15 | **No onboarding for Knowledge Map:** beautiful portrait but first-timers may not understand circles/points/mastery. | Mental model for domains/mastery isn't explained anywhere. | Short tooltip/guided tour explaining circle size, colours, connections. | Medium | Medium |
| 16 | **Home feed can feel overwhelming:** after the daily five — missed questions, recap, weekly reflection, multiple friend-challenge cards. | Density causes paralysis; breaks the "peaceful newspaper" rhythm. | Group actions under collapsible headings ("Catch up," "From Friends," "Recap & Reflection"); stagger CTAs. | Medium | High |
| 17 | **Catch-up flow lacks proper closure:** no celebration/summary after answering missed questions; page just closes. | Undercuts feedback loop and joy of closure. | "You're caught up!" state with light celebration + prompt to continue. | Low | Medium |
| 18 | **Knowledge frequency options ambiguous:** Knowledge Updated card asks Often/Sometimes/Blue Moon/Never with no explanation of effect. | Users may fear penalizing themselves or misread "Often." | Micro-copy: "Choosing 'Often' brings this topic back frequently in your Daily Five." | Low | Medium |
| 19 | **Contact discovery & invitations unclear:** privacy mentions phone-contact matching + mutual-friend suggestion, but invite flow is a generic "Invite someone." | Unclear whether invites use phone/email/link; deters users. | Dedicated invite flow: share via link/email/SMS with previews; show what's sent. | Medium | Medium |
| 20 | **Profile avatars default to initials;** no photo upload. | Faces help people bond; all-initials feels corporate. | Optional avatar uploads (with moderation) or contact-photo integration with consent. | Medium | Low |
| 21 | **Broken/inconsistent link styling:** some anchors underline, others rely on colour only. | Inconsistent affordances confuse what's clickable. | Standardize link design (underline all or clear hover states). | Low | Low |
| 22 | **Lack of dark mode:** cream palette may strain eyes at night. | Premium apps support dark themes for preference/accessibility. | Add dark mode with high contrast; update illustrations for legibility. | High | Medium |
| 23 | **No audible cues or haptics:** correct answer yields a green card but no sound/vibration. | Sensory feedback enhances delight. | Soft chimes / haptics for answers; accessibility toggle to disable. | Medium | Medium |
| 24 | **Knowledge categories limited to Western culture:** seeded topics skew U.S./European. | Global audience may feel under-represented. | Broaden seed base (African literature, Asian cinema, Indigenous histories); capture interests early. | High | High |
| 25 | **Missing micro-copy for first-time flows:** no guided onboarding, no explanation of streaks/points or "Daily Five is sacred." | First-timers may not grasp the core daily ritual. | One-time onboarding sequence conveying product canon + commitment to the ritual. | Medium | High |

## Launch Blockers

| Priority | Issue | Reasoning |
|---|---|---|
| **P0 — must fix** | Developer tools exposed (#1) | Debug controls visible would compromise trust and data integrity. |
| **P0** | Intermittent 404 on root (#2) | Landing on a 404 reads as broken; unacceptable for public launch. |
| **P1 — should fix** | Unclear "Show me the answer" flow (#3) | Confusing primary interaction on core gameplay hurts first-time retention. |
| **P1** | Auto-generated tagline / misrepresentation (#4) | Misrepresenting identity at signup erodes emotional connection. |
| **P1** | Unpolished question rewrite suggestions (#5) | Authoring is core; sloppy copy reduces perceived quality. |
| **P1** | Catch-up flow lacks confirmation (#8) | Accidentally burning a question frustrates users. |
| **P1** | No onboarding/context for Knowledge Map (#15) | Without understanding, users dismiss the map; hurts retention. |
| **P1** | Overwhelming home feed (#16) | Cognitive overload at arrival hurts the daily ritual. |
| **P2 — high-value polish** | Gear icon does nothing (#7) | Fix or remove to avoid confusion. |
| **P2** | Privacy explanations missing (#9) | Prevent accidental oversharing. |
| **P2** | Incomplete friend actions (#14) | Social loops drive virality. |
| **P2** | Knowledge frequency explanation (#18) | Clarify effect of user choices. |
| **P3 — nice** | Dark mode (#22), micro-copy, diversified knowledge base, haptic/audio feedback | Delight & inclusivity; not blocking. |

## Biggest Opportunities

- Guided onboarding that introduces the product canon and invites interest selection up front (Daily Five is sacred; questions are gifts; reflection is ritual).
- Expanded social features: messages, playful nudges ("Challenge Blake"), mini-leaderboards.
- Smart recommendation engine using the frequency settings to personalize the Daily Five; surface *why* a topic appears ("Because you and Blake both love Sondheim").
- Diverse content: broaden the knowledge base; invite global creators.
- Interactive knowledge map: zoom, explore connections, see friend overlaps.
- Shared experiences: cooperative/group modes (weekend quizzes, trivia nights).

## Strengths

- **Visual design & typography:** cream palette, serif headings, delicate coloured dots — premium, newspaper-like, tactile.
- **Daily Five rhythm:** five-a-day encourages healthy pacing and anticipatory joy; recap/catch-up reinforce learning.
- **Knowledge-update micro-interactions:** the frequency card empowers users to shape their learning.
- **Knowledge portrait:** circular map of territories/mastery is unique and memorable — visualises identity, not analytics.
- **Tone of voice:** "Between us," "Your world is expanding" — charming, on-philosophy.

## Most Consistent

- Card aesthetics (rounded corners, soft shadows, coloured chips) across pages.
- Progress indicators (Daily Five dots, answered-questions glyphs).
- Ambient friend activity (subtle on home/knowledge surfaces).

## Most Inconsistent

- Developer vs. production UI (debug features, 404 pages break the polish).
- Content tone (warm/witty vs. mechanical "Establishing"/rewrite copy).
- Interaction flows (reveal answers, save questions — multiple clicks / missing confirmations).
- Theme selector (card-colour toggle confusing and out of place).

## Scores (1–10)

| Area | Score | Rationale |
|---|---|---|
| Vision | 9 | Daily knowledge ritual + social discovery + identity is compelling and differentiated. |
| Product Design | 7 | Core flows strong; missing onboarding and unclear controls detract. |
| Interaction Design | 6 | Extra clicks, missing confirmations, dead icons; needs refinement. |
| Visual Design | 9 | Typography/palette/illustration polished; theme selector aside. |
| Craftsmanship | 6 | Debug tools, 404s, copy artefacts → not fully production-ready. |
| Emotional Design | 8 | Knowledge updates + witty copy evoke warmth; robotic phrasing reduces impact. |
| Retention Potential | 7 | Daily Five + knowledge map hook; onboarding/social depth gaps. |
| **Overall Product Quality** | **7** | Exciting product, clear vision, many delightful touches; fix blockers + polish to reach world-class. |

**Would I ship today?** Not yet — launch blockers (exposed dev tools, intermittent 404s, confusing answer reveal) and missing onboarding need addressing first.
