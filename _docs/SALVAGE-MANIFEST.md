
## QUESTION CREATION & BANK

| File | Category | Notes |
|------|----------|-------|
| src/app/api/questions/route.ts | SALVAGE WITH MODIFICATION | POST create question; update destinations (Bank/Share/Send); remove game pool refs |
| src/app/api/questions/[id]/route.ts | SALVAGE WITH MODIFICATION | GET/PATCH/DELETE question; remove game context |
| src/app/api/questions/suggest-answer/route.ts | SALVAGE AS-IS | LLM answer suggestion |
| src/app/api/questions/bank-add/route.ts | SALVAGE AS-IS | Add-to-bank (copy with provenance) |
| src/app/api/questions/review/route.ts | SALVAGE WITH MODIFICATION | Question review data; remove game context |
| src/components/QuestionForm.tsx | SALVAGE WITH MODIFICATION | Write flow; update destination toggles (bank/share/send per v11) |
| src/components/QuestionBankPicker.tsx | SALVAGE AS-IS | Bank picker UI |
| src/components/MultiQuestionCreateForm.tsx | SALVAGE WITH MODIFICATION | Batch question creation; remove game context |
| src/components/GameQuestionPicker.tsx | DELETE | Game question selection UI |
| src/app/questions/page.tsx | SALVAGE WITH MODIFICATION | Bank page; remove game-linked flows; show write + import + share options |
| src/app/questions/[id]/edit/page.tsx | SALVAGE WITH MODIFICATION | Edit question; remove game context |
| src/app/questions/new/page.tsx | SALVAGE WITH MODIFICATION | New question; update for v11 destinations |

---

## REACTIONS & ENGAGEMENT

| File | Category | Notes |
|------|----------|-------|
| src/app/api/reactions/route.ts | SALVAGE WITH MODIFICATION | POST reaction; remove game_id requirement; thumbs-up is Feed curation gesture |
| src/app/api/reactions/[reactionId]/respond/route.ts | SALVAGE WITH MODIFICATION | Creator reaction response; remove game_id |
| src/app/api/daily/feedback/route.ts | SALVAGE WITH MODIFICATION | Thumbs-up feedback; now primary curation signal |

---

## BIWEEKLY CEREMONY (v11)

| File | Category | Notes |
|------|----------|-------|
| src/lib/mastery/ceremony.ts | DELETE | Per-game ceremony; v11 requires complete rewrite for 14-day per-player rolling cadence with 5 beats |
| src/app/components/ceremony/* | DELETE | All game-ceremony beat components (AuthorshipImpactBeat, KnowledgeMapBeat, InvitationBeat, etc.) — v11 ceremony is fundamentally different (no group context) |
| src/app/groups/[groupId]/games/[gameId]/ceremony/page.tsx | DELETE | Game ceremony page |
| src/app/api/ceremony/[gameId]/category-gains/route.ts | DELETE | Game-level ceremony data |
| src/app/api/ceremony/[gameId]/personal-record/route.ts | DELETE | Game-level ceremony data |
| src/app/api/games/[gameId]/ceremony-status/route.ts | DELETE | Game ceremony status |
| src/app/api/games/[gameId]/ceremony/route.ts | DELETE | Game ceremony bootstrap |

---

## USER/FRIEND PROFILES

| File | Category | Notes |
|------|----------|-------|
| src/app/api/users/[userId]/portrait/route.ts | SALVAGE WITH MODIFICATION | Friend portrait; restrict to authenticated friends only (v10.25 was public/group-visible) |
| src/app/api/users/[userId]/portrait/friend/route.ts | SALVAGE WITH MODIFICATION | Friend portrait variant |
| src/app/api/users/[userId]/portrait/multitudes/route.ts | SALVAGE WITH MODIFICATION | Multitudes variant; adapt for friend graph |
| src/app/api/users/[userId]/knowledge/[domainName]/visibility/route.ts | SALVAGE WITH MODIFICATION | Domain visibility toggle; restrict to friends |
| src/app/api/users/[userId]/mastery/route.ts | SALVAGE WITH MODIFICATION | Mastery data; restrict to friends |
| src/app/api/users/[userId]/mastery/ceremony/route.ts | DELETE | Per-game ceremony mastery |
| src/app/api/users/[userId]/mastery/round-delta/route.ts | DELETE | Game round delta |
| src/app/api/users/[userId]/knowledge-card/route.ts | DELETE | Knowledge card sharing (season-card related) |
| src/app/api/users/[userId]/relational-summary/route.ts | DELETE | Game relational feedback |
| src/app/api/users/[userId]/progression-landscape/route.ts | SALVAGE WITH MODIFICATION | Progression data; adapt for v11 |
| src/app/users/[userId]/page.tsx | SALVAGE WITH MODIFICATION | Friend profile page; restrict visibility to friends |
| src/app/users/[userId]/not-found.tsx | SALVAGE AS-IS | 404 page |

---

## CONFIGURATION & CONSTANTS

| File | Category | Notes |
|------|----------|-------|
| src/lib/feature-flags.ts | SALVAGE WITH MODIFICATION | Remove EXPERT_CHALLENGES_UI_ENABLED; add FEED_ENABLED, BIWEEKLY_CEREMONY_ENABLED, etc. |
| src/lib/theme.ts | SALVAGE AS-IS | Theme utilities |
| src/lib/tokens.ts | SALVAGE AS-IS | Design tokens |
| src/lib/features.ts | SALVAGE WITH MODIFICATION | Feature detection; update for v11 scopes |
| src/lib/cache/safe-revalidate-tag.ts | SALVAGE AS-IS | Cache tag revalidation |

---

## PLAY COMPONENTS

| File | Category | Notes |
|------|----------|-------|
| src/components/play/GameplayChat.tsx | SALVAGE WITH MODIFICATION | Chat-thread interface; works for both Daily Five and Feed play; remove group/game state dependencies |
| src/components/play/GeometricProgress.tsx | SALVAGE WITH MODIFICATION | Progress indicator; adapt for Daily Five only |
| src/components/play/useAnswerSubmit.ts | SALVAGE WITH MODIFICATION | Answer submission hook; point to /api/daily/answer |
| src/components/play/useCatchupFlow.ts | SALVAGE WITH MODIFICATION | Catch-up flow; adapt for v11 |
| src/components/play/SessionCloseMessage.tsx | SALVAGE WITH MODIFICATION | Session close UI; adapt copy per v11 §8.1.13 |

---

## PROFILE/KNOWLEDGE COMPONENTS

| File | Category | Notes |
|------|----------|-------|
| src/components/knowledge/DomainCard.tsx | SALVAGE AS-IS | Domain detail display |
| src/components/knowledge/DomainCircle.tsx | SALVAGE AS-IS | Domain circle (mastery tier visualization) |
| src/components/knowledge/CategoryCircles.tsx | SALVAGE AS-IS | Circles-by-category display |
| src/components/knowledge/DomainList.tsx | SALVAGE AS-IS | Domain list display |
| src/components/knowledge/DomainRow.tsx | SALVAGE AS-IS | Domain row display |
| src/components/knowledge/DomainProgressBar.tsx | SALVAGE AS-IS | Tier progress bar |
| src/components/knowledge/DomainVisibilityToggle.tsx | SALVAGE AS-IS | Domain privacy toggle |
| src/components/knowledge/PortraitCircles.tsx | SALVAGE AS-IS | Portrait circle rendering |
| src/components/knowledge/SpiderGraph.tsx | SALVAGE AS-IS | Spider graph visualization |
| src/components/knowledge/KnowledgeCard.tsx | DELETE | Knowledge card sharing (season-card related) |
| src/components/knowledge/SharePortraitCard.tsx | DELETE | Share portrait card |
| src/components/knowledge/SharePortraitModal.tsx | DELETE | Share portrait modal |
| src/components/knowledge/KnowledgeOverviewClient.tsx | SALVAGE WITH MODIFICATION | Knowledge overview page client; adapt for v11 |
| src/components/knowledge/ProgressionLandscape.tsx | SALVAGE WITH MODIFICATION | Progression visualization; remove group context |

---

## SHARED UI COMPONENTS

| File | Category | Notes |
|------|----------|-------|
| src/components/LoadingScene.tsx | SALVAGE AS-IS | Loading UI |
| src/components/ContactPicker.tsx | SALVAGE AS-IS | (or minimal mod) Contact selection |
| src/components/QuickAddQuestionModal.tsx | SALVAGE WITH MODIFICATION | Quick question creation; adapt for v11 destinations |
| src/components/daily/DailyPreferencesControls.tsx | SALVAGE WITH MODIFICATION | Difficulty + domains config UI; add difficulty selector per v11 §8.1.3 |
| src/components/daily/PersonalDailySettingsForm.tsx | SALVAGE WITH MODIFICATION | Daily settings form; adapt for v11 preferences |
| src/components/icons/domain-icons.tsx | SALVAGE AS-IS | Domain emoji/icon mapping |
| src/components/progression/TierProgressBar.tsx | SALVAGE AS-IS | Tier progress display |
| src/components/profile/PersonalMasteryPage.tsx | SALVAGE WITH MODIFICATION | Player's own mastery page; adapt for v11 |
| src/components/profile/MyChallengesSection.tsx | DELETE | Expert challenges (killed) |
| src/components/share/* | DELETE | Season card sharing components (killed) |
| src/components/review/* | DELETE | Game review components (killed) |
| src/components/games/* | DELETE | Game detail display components |
| src/app/components/Nav.tsx | SALVAGE WITH MODIFICATION | Global nav; update to Home→Feed→Knowledge→Account per v11 §8.2.2 |

---

## PAGES

| File | Category | Notes |
|------|----------|-------|
| src/app/layout.tsx | SALVAGE WITH MODIFICATION | Root layout; update nav structure |
| src/app/page.tsx | SALVAGE WITH MODIFICATION | Landing/home hub; redesign for v11 (Feed indicator + Daily Five + Friends) |
| src/app/error.tsx | SALVAGE AS-IS | Error boundary |
| src/app/SplashToLogin.tsx | SALVAGE WITH MODIFICATION | Splash/login redirect; update for invitation-only landing |
| src/app/login/LoginPanel.tsx | SALVAGE WITH MODIFICATION | Login UI; add invitation code input |
| src/app/login/LoginHeroBanners.tsx | SALVAGE WITH MODIFICATION | Hero banners; update copy for v11 |
| src/app/login/page.tsx | SALVAGE WITH MODIFICATION | Login page |
| src/app/onboarding/OnboardingClient.tsx | DELETE | Group-game onboarding; v11 requires complete rewrite for hybrid interest declaration (warm-up Qs → LLM proposes → pick 5) |
| src/app/onboarding/page.tsx | DELETE | Group-game onboarding; v11 requires complete rewrite |
| src/app/daily/session/page.tsx | SALVAGE WITH MODIFICATION | Daily Five play page; core to v11; remove group/game context; adapt for DailyQueue |
| src/app/daily/summary/page.tsx | SALVAGE WITH MODIFICATION | Daily Five summary; adapt copy per v11 §8.1.13 |
| src/app/daily/settings/page.tsx | SALVAGE WITH MODIFICATION | Daily settings; expose difficulty control + domains selector per v11 §8.1.3 |
| src/app/daily/setup/page.tsx | DELETE | Game setup flow (v11 has onboarding) |
| src/app/questions/page.tsx | SALVAGE WITH MODIFICATION | Question bank page; update for write+import+share flows |
| src/app/questions/new/page.tsx | SALVAGE WITH MODIFICATION | New question page; update for v11 destinations |
| src/app/questions/[id]/edit/page.tsx | SALVAGE WITH MODIFICATION | Edit question page |
| src/app/knowledge/page.tsx | SALVAGE WITH MODIFICATION | Knowledge page; circles-by-category display (preserved); adapt for v11 |
| src/app/profile/page.tsx | SALVAGE WITH MODIFICATION | Player profile; remove challenges; add declared interests |
| src/app/profile/domains/[domainName]/page.tsx | SALVAGE WITH MODIFICATION | Domain detail page; adapt for v11 |
| src/app/users/[userId]/page.tsx | SALVAGE WITH MODIFICATION | Friend profile page; restrict visibility to authenticated friends; show declared interests + portrait + questions authored |
| src/app/users/[userId]/not-found.tsx | SALVAGE AS-IS | 404 |
| src/app/settings/page.tsx | SALVAGE WITH MODIFICATION | Account settings; remove group settings; add v11 notification prefs (SMS reminders, friend activity, etc.) |
| src/app/about/page.tsx | SALVAGE AS-IS | About page |
| src/app/join/page.tsx | SALVAGE WITH MODIFICATION | Invite join flow; adapt for v11 pre-seeded interests |
| src/app/groups/page.tsx | DELETE | Groups hub (v10.25 home) |
| src/app/groups/[groupId]/page.tsx | DELETE | Group detail page |
| src/app/groups/[groupId]/games/[gameId]/page.tsx | DELETE | Game detail page |
| src/app/groups/[groupId]/games/[gameId]/ceremony/page.tsx | DELETE | Game ceremony page |
| src/app/groups/[groupId]/games/[gameId]/summary/page.tsx | DELETE | Game summary page |
| src/app/groups/[groupId]/games/[gameId]/details/page.tsx | DELETE | Game details page |
| src/app/groups/[groupId]/games/[gameId]/bank/page.tsx | DELETE | Game question bank page |
| src/app/groups/[groupId]/games/[gameId]/multi-add/page.tsx | DELETE | Game multi-question add page |
| src/app/groups/[groupId]/games/[gameId]/rounds/[roundId]/summary/page.tsx | DELETE | Game round summary (not in v10.25 schema but in file list) |
| src/app/groups/new/page.tsx | DELETE | Create group/game flow |
| src/app/play/page.tsx | DELETE | Group game play page (different from daily play) |
| src/app/review/page.tsx | DELETE | Group game review page |
| src/app/replay/page.tsx | DELETE | Catch-up replay page (group-game tied) |
| src/app/leaderboard/page.tsx | DELETE | Group knowledge map leaderboard |
| src/app/stats/page.tsx | DELETE | Game stats page |
| src/app/public-games/page.tsx | DELETE | Public games (killed in v11) |
| src/app/games/page.tsx | SALVAGE WITH MODIFICATION | Games list; adapt or delete if no longer needed |
| src/app/c/[challengeToken]/* | DELETE | Challenge routes (expert challenges killed) |
| src/app/profile/challenges/* | DELETE | Challenge creation/management (killed) |
| src/app/share/* | DELETE | Season card share routes |

---

## API ROUTES (Additional)

| File | Category | Notes |
|------|----------|-------|
| src/app/api/groups/* | DELETE | All group management routes |
| src/app/api/games/* | DELETE | All game management routes (except maybe ceremony which is DELETE anyway) |
| src/app/api/assignments/* | DELETE | DailyAssignment routes (group/game tied) |
| src/app/api/sessions/* | DELETE | DailySession close-message route |
| src/app/api/stars/route.ts | DELETE | Star voting (replaced by thumbs-up feedback) |
| src/app/api/challenges/* | DELETE | Expert challenges (killed) |
| src/app/api/c/* | DELETE | Challenge play routes |
| src/app/api/replay/* | DELETE | Catch-up replay (group-game tied) |
| src/app/api/share/season-card/* | DELETE | Season card sharing (killed) |
| src/app/api/share/[sessionId]/route.ts | DELETE | Session/game sharing |
| src/app/api/me/editable-games/route.ts | DELETE | Game edit permission check |
| src/app/api/invitations/route.ts | DELETE | Old group invite system |
| src/app/api/players/route.ts | SALVAGE WITH MODIFICATION | Player lookup; adapt for friend-graph context |
| src/app/api/health/* | SALVAGE AS-IS | Health check endpoints |
| src/app/api/settings/theme/route.ts | SALVAGE AS-IS | Theme preference |
| src/app/api/users/domain-exclusions/* | SALVAGE AS-IS | User domain exclusions |

---

## CRON / JOBS

| File | Category | Notes |
|------|----------|-------|
| src/app/api/cron/daily-assignments/route.ts | DELETE | Group game daily assignment generation; v11 uses /api/daily/queue instead |

---

## TESTS

| File | Category | Notes |
|------|----------|-------|
| Tests in lib/games/__tests__/* | DELETE | Group-game tests (most irrelevant to v11) |
| Tests in lib/mastery/__tests__/* | SALVAGE WITH MODIFICATION | Mastery tests; adapt for v11 sourcing |
| Tests in lib/daily/__tests__/* | SALVAGE AS-IS | Daily queue tests (already v11-aligned) |
| Tests in lib/questions/__tests__/* | SALVAGE WITH MODIFICATION | Question tests; adapt for v11 |
| Tests in lib/profile/__tests__/* | SALVAGE WITH MODIFICATION | Profile tests; adapt for v11 friend-graph |
| All component/__tests__/* for games/groups | DELETE | Game/group component tests |

---

## SUMMARY

**Estimated Salvage Breakdown:**
- ~25% of codebase is direct SALVAGE AS-IS (auth, SMS, LLM, mastery tiers, daily queue types, knowledge display)
- ~35% requires significant SALVAGE WITH MODIFICATION (daily queue, mastery awards, profile/friends, question creation, pages)
- ~40% is DELETE (all group/game infrastructure, expert challenges, season cards, game ceremony)

**Critical New v11 Work:**
1. Build Friendship model & friend-request flow
2. Build Feed model & Feed page with three sources (direct-send, authored+shared, thumbs-up)
3. Rewrite ceremony for biweekly per-player 5-beat structure
4. Rewrite onboarding for hybrid interest declaration (warm-up Qs + LLM proposal)
5. Add interest declaration models (DeclaredInterest or integrate into User)
6. Rewrite home hub to show Feed indicator + Daily Five + Friends
7. Update friend profiles (restrict visibility to friends; show declared interests)
8. Add person-to-person invite with pre-seeded interests
9. Archive page with source filters
10. Personal Rounds (optional: player-initiated single-domain 5Q session)
11. Domain merge/split biweekly LLM process