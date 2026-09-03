import { sql } from 'drizzle-orm';

import type { QuestionSource } from '@/lib/questions-types';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const id = (name = 'id') =>
  text(name)
    .primaryKey()
    .default(sql`gen_random_uuid()::text`);
const createdAt = (name = 'created_at') =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
const updatedAt = (name = 'updated_at') =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
const textArrayDefault = sql`ARRAY[]::text[]`;

export const categoryEnum = pgEnum('Category', [
  'music',
  'literature',
  'history',
  'film_tv',
  'sport',
  'science',
  'philosophy',
  'pop_culture',
  'language',
  'general_knowledge',
]);

// 'blocked' is a safety hard-block terminal state (see verdictToBlockedVisibility):
// a question that failed the safety vet. It is NOT user-selectable and is excluded
// by questionVisibilityPredicate and every bank/send/game read path.
export const questionVisibilityEnum = pgEnum('QuestionVisibility', [
  'private',
  'public',
  'friends',
  'blocked',
]);

// B1 pool substrate (PRD-D-5 §5.1 / §6). Trust climbs as a question earns it:
// unverified (fresh, pre-checks) → machine_verified (retrieval + ask-to-answer,
// B3/B4) → human_validated (N humans correct in play) → author_confirmed
// (human-authored, answer asserted by author). B1 only adds the field + the
// grandfather backfill; live tier-gating stays OFF until B4.
export const trustTierEnum = pgEnum('TrustTier', [
  'unverified',
  'machine_verified',
  'human_validated',
  'author_confirmed',
]);
// Pool scope (PRD-D-5 §5.1 / D9). The spec models scope as friends_only | public
// (machine default public; human authored public with a one-tap friends_only
// override). We carry a third `private` value so the unified selection layer can
// represent the human Question.visibility 'private' losslessly; machine rows only
// ever use friends_only | public.
export const questionScopeEnum = pgEnum('QuestionScope', ['private', 'friends_only', 'public']);

// D-1 Stage 3 — directional follow model.
// `state` on a follow edge: a follow targeting an approval_required user lands
// as `pending` (a request the followee approves); a follow targeting a public
// user lands `approved` immediately. Invites create approved edges directly.
export const followStateEnum = pgEnum('FollowState', ['pending', 'approved']);
// Per-user gate on *new* followers. Default approval_required (opt into public).
export const followPrivacyEnum = pgEnum('FollowPrivacy', ['public', 'approval_required']);
export const publicStatusEnum = pgEnum('PublicStatus', [
  'not_scored',
  'eligible_pending',
  'opted_out',
  'migrated',
  'rejected',
  // B-QUESTION-QUALITY-AGENTS-01 (0096) — batch verification demote target: a
  // wrong answer / false premise was caught, so the question is pulled out of
  // circulation and surfaced to its owner. Appended last to match the
  // ALTER TYPE ... ADD VALUE ordering in the migration.
  'needs_review',
]);
export const answerSourceEnum = pgEnum('AnswerSource', [
  'llm_suggested',
  'creator_written',
  'llm_edited',
]);
export const questionStatusEnum = pgEnum('QuestionStatus', ['verified', 'unverified']);
// B-QUESTION-QUALITY-AGENTS-01 — outcome of the batch verification sweep, stamped
// on BOTH Question and GeneratedQuestion. `demoted` = a wrong answer / false
// premise was caught (Question → publicStatus 'needs_review'; GeneratedQuestion →
// is_duplicate = true); `unverifiable` = couldn't settle even with the web
// fallback; `skipped` = the pure pre-filter judged it non-claim-bearing; `ok` =
// checked and clean.
export const questionVerificationVerdictEnum = pgEnum('QuestionVerificationVerdict', [
  'ok',
  'demoted',
  'unverifiable',
  'skipped',
]);
export const questionTypeEnum = pgEnum('QuestionType', [
  'factual',
  'personal',
  'ambiguous',
  'factual_uncertain',
]);
export const gradeDisputeStatusEnum = pgEnum('GradeDisputeStatus', [
  'pending',
  'reviewed',
  'alternative_added',
  'dismissed',
]);
export const contentReportCategoryEnum = pgEnum('ContentReportCategory', [
  'incorrect',
  'inappropriate',
]);
export const contentReportIncorrectKindEnum = pgEnum('ContentReportIncorrectKind', [
  'answer_key',
  'premise',
]);
export const contentReportStatusEnum = pgEnum('ContentReportStatus', [
  'open',
  'upheld',
  'dismissed',
]);
export const difficultyEstimateEnum = pgEnum('DifficultyEstimate', [
  'accessible',
  'moderate',
  'specialist',
]);
export const reactionCannedEnum = pgEnum('ReactionCanned', [
  'always_knew',
  'got_me',
  'of_course_you',
  'never_heard',
  'need_to_talk',
  'didnt_know_tell_me',
  'need_story',
  'adding_to_list',
  'knew_i_wouldnt',
]);
export const creatorResponseCannedEnum = pgEnum('CreatorResponseCanned', [
  'knew_youd_get_it',
  'surprised_you_knew',
  'just_for_you',
  'story_here',
]);
/**
 * Vestigial v10.25 message types retained for database compatibility only.
 * Do not use in new application code:
 * - star_notification
 * - game_complete
 * - game_summary_ready
 * - incognito_round_invitation
 * - anniversary_milestone
 */
export const smsMessageTypeEnum = pgEnum('SmsMessageType', [
  'otp',
  'sms_opt_in_confirmation',
  'daily_questions',
  'daily_questions_batched',
  'invitation',
  'star_notification',
  'correct_answer_notification',
  'question_reaction',
  'creator_reaction_response',
  'game_complete',
  'game_summary_ready',
  'expiry_reminder',
  'incognito_round_invitation',
  'anniversary_milestone',
  // Retired with the post-wrong-answer CreatorNote nudge (B-3). Kept as
  // tombstones because Postgres can't cleanly drop enum values; no code emits these.
  'creator_note_prompt',
  'creator_note_received',
  'ceremony_ready',
  'joshing_game_received',
  'joshing_game_progress',
  'joshing_game_complete',
  'friend_answered_question',
  // D-MISSED-RETURN-01 §7-A1 — the author push when a question they wrote comes
  // back to a player who once missed it and this time lands correct. The
  // wrong→right moment is the strongest positive signal the product makes and
  // nothing carried it back to the author before.
  'missed_return_recovered',
]);
export const answerStateEnum = pgEnum('AnswerState', [
  'first_correct',
  'first_correct_after_wrong',
  'repeat_correct',
  'incorrect',
]);
export const smsOptInEnum = pgEnum('SmsOptIn', ['opted_in', 'opted_out', 'not_asked']);
export const emailOptInEnum = pgEnum('EmailOptIn', ['opted_in', 'opted_out', 'not_asked']);
export const themePreferenceEnum = pgEnum('ThemePreference', [
  'quiet_atelier',
  'sunday_margins',
  'parlor_index',
]);
export const subscriptionPlanEnum = pgEnum('SubscriptionPlan', [
  'free',
  'plus_monthly',
  'plus_yearly',
]);
export const masteryTierEnum = pgEnum('MasteryTier', [
  'establishing',
  'familiar',
  'solid',
  'mastery',
]);
export const domainExclusionScopeEnum = pgEnum('DomainExclusionScope', [
  'subcategory',
  'broad_category',
  'category',
]);
export const masterySourceTypeEnum = pgEnum('MasterySourceType', [
  'live_correct',
  'authored',
  'author_credit',
  'curator_credit',
  'catchup_correct',
  'domain_merged',
  'declared_promoted',
  'expansion',
]);
export const feedbackSignalEnum = pgEnum('FeedbackSignal', ['thumbs_up', 'thumbs_down']);
export const territoryTypeEnum = pgEnum('TerritoryType', ['declared', 'demonstrated']);
// Migration 0054 added the 'knowledge_base' value and stopped using
// 'bio', 'tagline', 'location', 'knowledge_map', and 'mind_expanding'.
// Postgres doesn't support dropping individual enum values, so the legacy
// values remain in the DB enum type as zombies. They are deliberately
// omitted here so app code can't reintroduce a reference.
export const profileSectionEnum = pgEnum('ProfileSection', [
  'knowledge_base',
  'friends_list',
  'authored_questions',
]);

export const users = pgTable(
  'User',
  {
    id: id(),
    phoneNumber: text('phone_number').notNull(),
    email: text('email'),
    displayName: text('display_name'),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    timezone: text('timezone').notNull().default('America/New_York'),
    isSubscriber: boolean('is_subscriber').notNull().default(false),
    preferredTheme: themePreferenceEnum('preferred_theme').notNull().default('quiet_atelier'),
    subscriptionPlan: subscriptionPlanEnum('subscription_plan').notNull().default('free'),
    smsOptIn: smsOptInEnum('sms_opt_in').notNull().default('not_asked'),
    smsReminderTime: integer('sms_reminder_time'),
    smsOptInAt: timestamp('sms_opt_in_at', { withTimezone: true }),
    smsOptOutAt: timestamp('sms_opt_out_at', { withTimezone: true }),
    smsConsentSource: text('sms_consent_source'),
    smsConsentPolicyVersion: text('sms_consent_policy_version'),
    emailOptIn: emailOptInEnum('email_opt_in').notNull().default('not_asked'),
    emailVerified: boolean('email_verified').notNull().default(false),
    pendingEmail: text('pending_email'),
    reminderPromptDismissedAt: timestamp('reminder_prompt_dismissed_at', { withTimezone: true }),
    // D-REMINDER-INTERSTITIAL-01: stamped when the one-time full-screen reminder
    // interstitial is shown (on BOTH sign-up and skip), so it fires at most once.
    // Deliberately separate from reminderPromptDismissedAt (Decision D): skipping
    // the interstitial is "not now", not "never" — it must not retire the
    // standing inline RoundReminderCard, so it cannot share that column.
    reminderInterstitialSeenAt: timestamp('reminder_interstitial_seen_at', { withTimezone: true }),
    areaTopUpPromptDismissedAt: timestamp('area_top_up_prompt_dismissed_at', {
      withTimezone: true,
    }),
    lastActivityBellOpenedAt: timestamp('last_activity_bell_opened_at', { withTimezone: true }),
    knowledgeCardShareToken: text('knowledge_card_share_token'),
    knowledgeCardShareExpiresAt: timestamp('knowledge_card_share_expires_at', {
      withTimezone: true,
    }),
    slug: text('slug'),
    handle: text('handle'),
    handleLastChangedAt: timestamp('handle_last_changed_at', { withTimezone: true }),
    // DEPRECATED (B-FRIENDS-INVITE-LINKS-01, 2026-09-03) — superseded by the
    // userInviteLinks table (up to 3 links per user). No longer read or
    // written; every prior value was backfilled into one untagged
    // UserInviteLink row in migration 0135. Column + its partial unique index
    // (idx_users_invite_token, migration 0049) are kept for one deploy cycle
    // before a follow-up migration drops them, so a rollback of the read-path
    // swap has somewhere to land.
    inviteToken: text('invite_token'),
    // Topics the per-user invite links carry — up to 3, in slot order. Shaped
    // like FriendInvitation.preSeededInterests (array of {label, description?,
    // broadCategory?}), capped at 3 by the app layer, not the column. NULL/empty
    // means "no curated set" — invite links fall back to the inviter's top
    // 'often'-frequency domains, then declared interests (see
    // getInviteLinkSeedTopics).
    inviteSeedInterests: jsonb('invite_seed_interests'),
    // Set once, on accept, by acceptUserInviteLink. Survives the link being
    // later deleted (soft delete keeps the UserInviteLink row), so a link's
    // join count and a joiner's Suggested-friends provenance never dangle.
    // NULL for every pre-existing account and for anyone who joined via the
    // named FriendInvitation path instead.
    joinedViaInviteLinkId: text('joined_via_invite_link_id').references(
      (): AnyPgColumn => userInviteLinks.id,
    ),
    avatarColor: text('avatar_color'),
    discoverableByContacts: boolean('discoverable_by_contacts').notNull().default(false),
    discoverableByMutualFriends: boolean('discoverable_by_mutual_friends').notNull().default(false),
    // D-2 niche-match discovery. TEST-PHASE default ON (DEFAULT true) — deliberate
    // for the test cohort only. The production default is an OPEN DECISION to
    // revisit after the test; do not assume default-ON as the shipping default.
    // See drizzle/0059_niche_match_discoverability.sql.
    discoverableByNicheMatch: boolean('discoverable_by_niche_match').notNull().default(true),
    // D-4 via-attribution: gates the "via {source}" forward-relay discovery
    // exposure — the flag of the EXPOSED party (whoever the question was forwarded
    // from) controls whether their identity surfaces to a downstream stranger
    // recipient. Sibling to discoverable_by_niche_match, kept separate so
    // forward-relay exposure opts out independently of niche-match. TEST-PHASE
    // default ON (mirrors niche-match); the production default is an OPEN DECISION
    // to revisit after the test. See the D-4 amendment.
    discoverableByForward: boolean('discoverable_by_forward').notNull().default(true),
    // D-1 Stage 3 — gate on new followers. Default approval_required; public is opt-in.
    followPrivacy: followPrivacyEnum('follow_privacy').notNull().default('approval_required'),
    phoneHash: text('phone_hash'),
    lastFriendDiscoveryCheckAt: timestamp('last_friend_discovery_check_at', { withTimezone: true }),
    onboardingComplete: boolean('onboardingComplete').notNull().default(false),
    // B-FirstRecap-1: timestamp the one-time first-session recap was shown. NULL
    // until the user sees the cinematic recap that fires after their first ever
    // completed Daily Five; set once so re-entry/refresh/catch-up never re-fire it.
    firstSessionRecapSeenAt: timestamp('first_session_recap_seen_at', { withTimezone: true }),
    // B-FirstGameRecap-1: timestamp the one-time first-game recap was shown.
    // Separate from firstSessionRecapSeenAt so Daily Five and Joshing game
    // onboarding ceremonies never suppress each other.
    firstGameRecapSeenAt: timestamp('first_game_recap_seen_at', { withTimezone: true }),
    birthYear: integer('birth_year'),
    grewUpCountry: text('grew_up_country'),
    grewUpRegion: text('grew_up_region'),
    adaptiveLevel: doublePrecision('adaptiveLevel').notNull().default(1.0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('User_phone_number_key').on(table.phoneNumber),
    uniqueIndex('User_email_key').on(table.email),
    uniqueIndex('User_knowledge_card_share_token_key').on(table.knowledgeCardShareToken),
    uniqueIndex('User_slug_key').on(table.slug),
    index('User_phone_number_idx').on(table.phoneNumber),
  ],
);

export const userSessions = pgTable(
  'UserSession',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('UserSession_token_key').on(table.token),
    index('UserSession_token_idx').on(table.token),
    index('UserSession_user_id_idx').on(table.userId),
  ],
);

export const otpCodes = pgTable(
  'OtpCode',
  {
    id: id(),
    phoneNumber: text('phone_number').notNull(),
    code: text('code').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('OtpCode_phone_number_idx').on(table.phoneNumber)],
);

export const questions = pgTable(
  'Question',
  {
    id: id(),
    creatorId: text('creator_id').references(() => users.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id, {
      onDelete: 'set null',
    }),
    source: text('source').$type<QuestionSource>().notNull().default('authored'),
    sourceQuestionId: text('source_question_id'),
    sourceCreatorId: text('source_creator_id'),
    questionText: text('question_text').notNull(),
    breadcrumbContext: text('breadcrumb_context').notNull().default(''),
    answerText: text('answer_text').notNull(),
    factualExplanation: text('factual_explanation'),
    acceptedAlternatives: text('accepted_alternatives').array().notNull().default(textArrayDefault),
    answerSource: answerSourceEnum('answer_source'),
    questionType: questionTypeEnum('question_type').notNull().default('factual'),
    minimumRequired: integer('minimum_required'),
    category: categoryEnum('category').notNull().default('general_knowledge'),
    broadCategory: text('broad_category'),
    subcategory: text('subcategory'),
    canonicalSubcategory: text('canonical_subcategory'),
    categoryOverridden: boolean('category_overridden').notNull().default(false),
    // B-LLM-PROVIDER-AB-SWITCH B3: which provider CATEGORIZED this question
    // ('anthropic'|'openai'). Distinct from generation provenance (a question can
    // be generated by one provider and categorized by another). Nullable — set
    // only when categorizeQuestion runs; historical rows stay null.
    categorizeProvider: text('categorize_provider'),
    creatorNote: text('creator_note'),
    insideJoke: text('inside_joke'),
    // Primary subject the question is ABOUT (carried from GeneratedQuestion on
    // promotion, or backfilled). Feeds the Tier 2 subject-cooldown gate. Nullable.
    subjectEntity: text('subject_entity'),
    difficultyEstimate: difficultyEstimateEnum('difficulty_estimate'),
    llmDifficulty: difficultyEstimateEnum('llm_difficulty'),
    calibratedDifficulty: difficultyEstimateEnum('calibrated_difficulty'),
    correctRate: doublePrecision('correct_rate'),
    explainerBrief: text('explainer_brief'),
    explainerFull: text('explainer_full'),
    explainerBriefCorrect: text('explainer_brief_correct'),
    explainerFullCorrect: text('explainer_full_correct'),
    explainerBriefWrong: text('explainer_brief_wrong'),
    explainerFullWrong: text('explainer_full_wrong'),
    explainerBriefExpired: text('explainer_brief_expired'),
    explainerFullExpired: text('explainer_full_expired'),
    shortLabel: text('short_label'),
    status: questionStatusEnum('status').notNull().default('verified'),
    verified: boolean('verified').notNull().default(true),
    llmSuggestedAnswer: text('llm_suggested_answer'),
    critiqueIterations: integer('critique_iterations').notNull().default(0),
    visibility: questionVisibilityEnum('visibility').notNull().default('public'),
    publicStatus: publicStatusEnum('public_status').notNull().default('not_scored'),
    publicEligibilityScore: doublePrecision('public_eligibility_score'),
    publicEligibilityReason: text('public_eligibility_reason'),
    sharedToFriendsFeed: boolean('sharedToFriendsFeed').notNull().default(false),
    askedCount: integer('asked_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    surfacePriorityScore: doublePrecision('surface_priority_score').notNull().default(0),
    // B1 pool substrate (PRD-D-5 §5.1). Human-authored rows grandfather to
    // author_confirmed. Scope, n_answered and empirical_correct_rate are NOT
    // duplicated here — the unified selection layer reuses visibility, askedCount
    // and correctRate (see src/server/db/queries/pool.ts).
    trustTier: trustTierEnum('trust_tier').notNull().default('unverified'),
    // Perishable = time-relative facts ("the latest…", "who currently…") flagged
    // for re-grounding (B3); evergreen by default (no decay — D8).
    perishable: boolean('perishable').notNull().default(false),
    // Provenance refs from retrieval-grounded generation; populated in B3.
    sourceRefs: jsonb('source_refs').$type<string[]>().notNull().default([]),
    // "Nobody got it" smell (B4 Phase 2, §5.3 layer 3 / §7). True when ≥N distinct
    // domain-holders have answered and NONE got it right — a hallucination smell,
    // not a hard question. Flags for review; never auto-deletes (no decay, D8).
    nobodyCorrectFlag: boolean('nobody_correct_flag').notNull().default(false),
    // Embedding-dedup flags (B3). Human beats machine on collision; the loser is
    // suppressed (flagged), never deleted. suppressedBy holds the surviving
    // question id (may live in either table, so not a hard FK).
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    suppressedBy: text('suppressed_by'),
    // Account-deletion tombstone marker (D-ACCOUNT-DELETION-TERRITORY-01). True
    // when the human author deleted their account and this question was retained
    // (a retained user has proven territory on it) and re-sourced to the house
    // identity: creator_id NULL + source 'house_authored'. Distinguishes a
    // tombstone from a born-house question (which is author_deleted = false).
    // Invariant H-1 still holds — a tombstone never renders as a person.
    authorDeleted: boolean('author_deleted').notNull().default(false),
    // Voyage voyage-3.5-lite embedding (1024-dim) — semantic-dedup backstop.
    // Nullable: populated at insert and by the batched backfill (B3).
    embedding: vector('embedding', { dimensions: 1024 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // B-QUESTION-QUALITY-AGENTS-01 Phase 1 — batch-verification stamp. verifiedAt
    // null = not yet swept (the sweep selects these and never re-processes a
    // stamped row); verificationVerdict records the outcome. A demote also sets
    // publicStatus = 'needs_review' alongside verdict = 'demoted'.
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationVerdict: questionVerificationVerdictEnum('verification_verdict'),
    // B-CRAFTER-LIFECYCLE-01 Phase 1 (0100) — the verifier's short verdict reason,
    // shown on the admin review queue's machine-demotion cards. Nullable; rows
    // verified before 0100 stay null (the reason was previously discarded).
    verificationReason: text('verification_reason'),
  },
  (table) => [
    index('Question_creator_id_idx').on(table.creatorId),
    index('Question_creator_id_deleted_at_idx').on(table.creatorId, table.deletedAt),
    index('Question_creator_id_visibility_idx').on(table.creatorId, table.visibility),
    index('Question_broad_category_idx').on(table.broadCategory),
    index('Question_canonical_subcategory_idx').on(table.canonicalSubcategory),
    index('Question_source_question_id_idx').on(table.sourceQuestionId),
    index('Question_source_creator_id_idx').on(table.sourceCreatorId),
    uniqueIndex('Question_generated_question_id_key').on(table.generatedQuestionId),
    // Selection-layer filters (B1 pool substrate). Filter capability only — no
    // live tier-gating yet (B4 owns enforcement).
    index('Question_trust_tier_idx').on(table.trustTier),
    index('Question_is_duplicate_idx').on(table.isDuplicate),
    // Partial index for the "nobody got it" review queue (B4 Phase 2): the flag is
    // true for a tiny minority of rows, so a partial index keeps the scan cheap.
    index('Question_nobody_correct_flag_idx')
      .on(table.nobodyCorrectFlag)
      .where(sql`${table.nobodyCorrectFlag} = true`),
    // Partial index for tombstone-aware render/query paths (the flag is true for
    // a tiny minority of rows). D-ACCOUNT-DELETION-TERRITORY-01 / migration 0080.
    index('Question_author_deleted_idx')
      .on(table.authorDeleted)
      .where(sql`${table.authorDeleted} = true`),
  ],
);

export const questionAudienceTags = pgTable(
  'QuestionAudienceTag',
  {
    id: id(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    creatorId: text('creator_id').notNull(),
    tag: text('tag').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('QuestionAudienceTag_creator_id_idx').on(table.creatorId),
    index('QuestionAudienceTag_question_id_idx').on(table.questionId),
  ],
);

export const userQuestionBank = pgTable(
  'UserQuestionBank',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedFromContextType: text('added_from_context_type').$type<
      'feed' | 'joshing_game' | 'manual'
    >(),
    addedFromContextId: text('added_from_context_id'),
  },
  (table) => [
    unique('UserQuestionBank_user_id_question_id_key').on(table.userId, table.questionId),
    index('UserQuestionBank_user_id_idx').on(table.userId),
    index('UserQuestionBank_question_id_idx').on(table.questionId),
    // Backs the Questions-tab list (getBankedQuestions): filter on user_id,
    // ORDER BY added_at DESC. Lets the planner serve both from one index
    // instead of sorting the whole bank in memory per load (0082).
    index('UserQuestionBank_user_id_added_at_idx').on(table.userId, table.addedAt),
  ],
);

export const playerMastery = pgTable(
  'PLAYER_MASTERY',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    broadCategory: text('broad_category'),
    totalPoints: doublePrecision('total_points').notNull().default(0),
    tier: masteryTierEnum('tier').notNull().default('establishing'),
    tierReachedAt: timestamp('tier_reached_at', { withTimezone: true }),
    lifetimePointsBaseline: doublePrecision('lifetime_points_baseline').notNull().default(0),
    territoryType: territoryTypeEnum('territory_type').notNull().default('demonstrated'),
    // B-DOMAIN-BONUS-ROTATION-01: may this demonstrated domain feed the core
    // top-5 rotation? Defaults true (existing + core/feed/declared rows stay
    // eligible); a row first minted by a +2 bonus answer is written false so a
    // friend's domain can't leak into the main five until the player adopts it
    // (a non-resting frequency) or declares it. See getKnowledgeBase.
    rotationEligible: boolean('rotation_eligible').notNull().default(true),
    // D-SUPPLY-FINITE-SET-01 P2: the durable "you completed this set" recognition
    // (designation). Set once a player has answered the domain's whole set; drives
    // the /invited trophy's permanence. Recognition only — no mechanical effect.
    // NULL = not yet designated. Mirrors tier_reached_at.
    designatedAt: timestamp('designated_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('PLAYER_MASTERY_user_id_canonical_subcategory_key').on(
      table.userId,
      table.canonicalSubcategory,
    ),
    index('PLAYER_MASTERY_user_id_idx').on(table.userId),
    index('PLAYER_MASTERY_canonical_subcategory_idx').on(table.canonicalSubcategory),
  ],
);

// Generic per-user-per-day usage counter for rate-limited, on-demand LLM
// endpoints (answer suggestion, verify-answer, crafter drafting, critique,
// question creation, ...). One row per (user, day, action); `action` is a
// free-form key each call site owns (e.g. 'critique', 'suggest-answer').
// Superseded the critique-only `CritiqueUsageDaily` table (see migration
// 0126) once a second caller needed the same pattern.
export const llmUsageDaily = pgTable(
  'LlmUsageDaily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    usageDate: date('usage_date').notNull(),
    action: text('action').notNull(),
    count: integer('count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('LlmUsageDaily_user_id_usage_date_action_key').on(
      table.userId,
      table.usageDate,
      table.action,
    ),
    index('LlmUsageDaily_user_id_usage_date_action_idx').on(
      table.userId,
      table.usageDate,
      table.action,
    ),
  ],
);

export const masteryEvents = pgTable(
  'MASTERY_EVENTS',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    sourceType: masterySourceTypeEnum('source_type').notNull(),
    questionId: text('question_id').references(() => questions.id),
    answeredByUserId: text('answered_by_user_id'),
    answerId: text('answer_id'),
    basePoints: integer('base_points').notNull().default(0),
    weight: doublePrecision('weight').notNull().default(0),
    awardedPoints: doublePrecision('awarded_points').notNull().default(0),
    answerState: answerStateEnum('answer_state'),
    sessionContext: text('session_context'),
    metadata: jsonb('metadata'),
    // B-LLM-PROVIDER-AB-SWITCH B3: which provider GRADED this answer
    // ('anthropic'|'openai'), or null when the grade never hit an LLM (exact-match
    // fast-path / give-up) or grading wasn't routed. answer_state distinguishes
    // correct vs wrong, so wrong-answer grading provenance (the north-star) is
    // joinable here. Nullable — historical rows stay null.
    llmProvider: text('llm_provider'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('MASTERY_EVENTS_answer_id_key').on(table.answerId),
    unique('MASTERY_EVENTS_source_type_question_id_answered_by_user_id_key').on(
      table.sourceType,
      table.questionId,
      table.answeredByUserId,
    ),
    index('MASTERY_EVENTS_user_id_idx').on(table.userId),
    index('MASTERY_EVENTS_canonical_subcategory_idx').on(table.canonicalSubcategory),
    index('MASTERY_EVENTS_question_id_idx').on(table.questionId),
    index('MASTERY_EVENTS_answered_by_user_id_idx').on(table.answeredByUserId),
    // Composite covers the hot viewer-status lookup at
    // src/server/db/queries/feed.ts:478 (getViewerAnswerStatusForQuestions,
    // called on every feed render) and the archive timeline reader at
    // src/server/db/queries/archive.ts:241 — both filter on userId +
    // answeredByUserId and then by question. Single-column indexes were forcing
    // bitmap-AND merges of two separate scans.
    index('MASTERY_EVENTS_user_id_answered_by_user_id_question_id_idx').on(
      table.userId,
      table.answeredByUserId,
      table.questionId,
    ),
    // Covers the "Lately" convergence lookback at
    // src/server/db/queries/lately.ts (getLatelyConvergences): equality on
    // user_id + IN on source_type + IN on answer_state, then a created_at
    // range over the 60-day window. The single-column user_id index forced a
    // full scan of the viewer's history filtered in the heap; this composite
    // narrows to the matching prefix and orders by created_at.
    index('MASTERY_EVENTS_user_id_source_type_answer_state_created_at_idx').on(
      table.userId,
      table.sourceType,
      table.answerState,
      table.createdAt,
    ),
  ],
);

export const questionReactions = pgTable(
  'QuestionReaction',
  {
    id: id(),
    senderUserId: text('senderUserId')
      .notNull()
      .references(() => users.id),
    recipientUserId: text('recipientUserId')
      .notNull()
      .references(() => users.id),
    questionId: text('questionId')
      .notNull()
      .references(() => questions.id),
    contextType: text('contextType').$type<'feed' | 'joshing_game'>().notNull(),
    contextId: text('contextId'),
    reactionType: text('reactionType').notNull(),
    customMessage: text('customMessage'),
    // §8.22 opt-in. When true on a wrong-answer reaction, the answerer
    // consents to the question's author seeing their literal submitted text
    // alongside the reaction.
    includeSubmittedAnswer: boolean('includeSubmittedAnswer').notNull().default(false),
    repliedAt: timestamp('repliedAt', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('QuestionReaction_recipientUserId_repliedAt_idx').on(
      table.recipientUserId,
      table.repliedAt,
    ),
    index('QuestionReaction_senderUserId_idx').on(table.senderUserId),
    index('QuestionReaction_questionId_idx').on(table.questionId),
    index('QuestionReaction_context_idx').on(table.contextType, table.contextId),
  ],
);

export const gradeDisputes = pgTable(
  'GradeDispute',
  {
    id: id(),
    answerId: text('answer_id').notNull(),
    questionId: text('question_id').notNull(),
    creatorId: text('creator_id').notNull(),
    submittedAnswer: text('submitted_answer').notNull(),
    canonicalAnswer: text('canonical_answer').notNull(),
    questionText: text('question_text'),
    surface: text('surface'),
    reviewDecision: text('review_decision'),
    reviewReason: text('review_reason'),
    acceptedAlternative: text('accepted_alternative'),
    status: gradeDisputeStatusEnum('status').notNull().default('pending'),
    createdAt: createdAt(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('GradeDispute_answer_id_key').on(table.answerId),
    index('GradeDispute_question_id_idx').on(table.questionId),
    index('GradeDispute_creator_id_idx').on(table.creatorId),
    index('GradeDispute_status_idx').on(table.status),
  ],
);

export const smsLogs = pgTable(
  'SmsLog',
  {
    id: id(),
    userId: text('user_id'),
    phoneNumber: text('phone_number'),
    messageType: smsMessageTypeEnum('message_type').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('SmsLog_user_id_idx').on(table.userId),
    index('SmsLog_phone_number_idx').on(table.phoneNumber),
    index('SmsLog_message_type_sent_at_idx').on(table.messageType, table.sentAt),
  ],
);

export const emailVerificationTokens = pgTable(
  'EmailVerificationToken',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    // When true, confirming this token also flips emailOptIn → 'opted_in'
    // (the onboarding beat captures the user's intent up front). Profile-issued
    // tokens leave this false: verifying only confirms the address there.
    optInOnConfirm: boolean('opt_in_on_confirm').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('EmailVerificationToken_token_hash_key').on(table.tokenHash),
    index('EmailVerificationToken_user_id_idx').on(table.userId),
  ],
);

export const generatedQuestions = pgTable(
  'GeneratedQuestion',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    // domainKey() fold of canonical_subcategory (apostrophes folded, whitespace
    // collapsed, lowercased), written by the TS fold at insert time. The bank
    // lookup matches on this so spelling variants of one domain share stock
    // (migration 0074, BP-7 / audit C5). Nullable: rows pre-dating the column
    // match via the legacy exact predicate until backfilled.
    domainKey: text('domain_key'),
    broadCategory: text('broad_category').notNull(),
    questionText: text('question_text').notNull(),
    answer: text('answer').notNull(),
    explainer: text('explainer').notNull(),
    difficultyEstimate: text('difficulty_estimate').notNull(),
    basePoints: integer('base_points').notNull(),
    // Normalized identifier for the underlying fact (e.g.
    // 'gotterdammerung-hagen-summons-vassals-instrument'). Lets us dedup
    // re-wordings of the same trivia that the text-level check misses.
    // Nullable so older rows generated before this column existed remain valid.
    factKey: text('fact_key'),
    // 1-3 short tags identifying which facets of the domain this question
    // covers (e.g. "Septimus shell shock", "Cymbeline allusion"). Aggregated
    // per domain and fed back to the generation prompt as positive guidance:
    // "you've covered X, Y, Z — pick something else." See migration 0055.
    subAngles: text('sub_angles').array().notNull().default([]),
    // Primary subject the question is ABOUT (e.g. "Peter Pettigrew", "Guys and
    // Dolls"), emitted by the generator. Distinct from fact_key (which encodes
    // the specific fact) — used by the Tier 2 subject-cooldown gate to space out
    // same-subject questions across a window. Nullable: older rows pre-date the
    // column; the backfill (scripts/backfill-subject-entity.ts) fills them.
    subjectEntity: text('subject_entity'),
    // Precomputed "between us" aside, generated once at question-generation time
    // (src/server/daily/generate-questions.ts) and copied into Question.inside_joke
    // when the row is persisted. Nullable: older rows and any where generation
    // failed simply have no aside.
    insideJoke: text('inside_joke'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedInQueue: boolean('used_in_queue').notNull().default(false),
    // B1 pool substrate (PRD-D-5 §5.1). Machine rows grandfather to
    // machine_verified; scope defaults public. Unlike the human table, the
    // machine bank has no native scope/answered/correct-rate columns, so these
    // are added here (the selection layer reads them directly).
    trustTier: trustTierEnum('trust_tier').notNull().default('unverified'),
    scope: questionScopeEnum('scope').notNull().default('public'),
    perishable: boolean('perishable').notNull().default(false),
    sourceRefs: jsonb('source_refs').$type<string[]>().notNull().default([]),
    // Ask-to-answer record (B4 Phase 1, PRD-D-5 §5.3 layer 2). True when an
    // independent cold solver corroborated the stored answer at generation time.
    // This + B3 corroboration is what earns the machine_verified trust tier.
    askToAnswerVerified: boolean('ask_to_answer_verified').notNull().default(false),
    // Acceptable answer variants (B4 Phase 4, §5.3). Equivalent phrasings the cold
    // solver produced that the judge accepted; honored in grading so a right-but-
    // rephrased answer is marked correct. Carried to Question.accepted_alternatives
    // when a machine row is promoted to canonical.
    acceptableVariants: text('acceptable_variants').array().notNull().default([]),
    // Empirical play stats (D11 / "nobody got it" smell). Back-filled from answer
    // history where a join exists; machine rows usually start 0 / null.
    nAnswered: integer('n_answered').notNull().default(0),
    empiricalCorrectRate: doublePrecision('empirical_correct_rate'),
    // Embedding-dedup flags (B3). On a human-beats-machine collision, the machine
    // row is the loser: is_duplicate=true, suppressed_by=<human id>. Never deleted.
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    suppressedBy: text('suppressed_by'),
    // B-QUESTION-QUALITY-AGENTS-01 Phase 1 — batch-verification stamp (same shape
    // as Question). A demote on this table suppresses via is_duplicate = true; the
    // verdict is recorded here. verifiedAt null = not yet swept.
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationVerdict: questionVerificationVerdictEnum('verification_verdict'),
    // B-CRAFTER-LIFECYCLE-01 Phase 1 (0100) — same shape as Question: the
    // verifier's short verdict reason for the admin review queue. Nullable.
    verificationReason: text('verification_reason'),
    // Voyage voyage-3.5-lite embedding (1024-dim) — semantic-dedup backstop.
    embedding: vector('embedding', { dimensions: 1024 }),
    // B-LLM-PROVIDER-AB-SWITCH B3: which provider GENERATED this row
    // ('anthropic'|'openai'). Nullable — historical rows stay null (no backfill).
    generatedByProvider: text('generated_by_provider'),
  },
  (table) => [
    index('GeneratedQuestion_user_id_idx').on(table.userId),
    index('GeneratedQuestion_user_id_used_in_queue_idx').on(table.userId, table.usedInQueue),
    index('GeneratedQuestion_user_id_fact_key_idx').on(table.userId, table.factKey),
    // Selection-layer filters (B1): tier/scope filter capability + suppress-aware
    // bank pick. Not gated on any live surface yet (B4 owns enforcement).
    index('GeneratedQuestion_trust_tier_idx').on(table.trustTier),
    index('GeneratedQuestion_is_duplicate_idx').on(table.isDuplicate),
    // Bank lookup path (BP-7 / C5): pickBankSource matches folded domain +
    // difficulty tier.
    index('GeneratedQuestion_domain_key_difficulty_idx').on(
      table.domainKey,
      table.difficultyEstimate,
    ),
  ],
);

// Per-domain retrieval-refill health (migration 0098, B-SUPPLY-REFILL-THROUGHPUT-01
// follow-up). runPoolRefill records whether each domain's grounded call completed
// or timed out; getThinActiveDomains skips domains that have timed out
// consecutively >= a threshold and are still within a cooldown, so the capped cron
// budget stops being spent on chronically-slow (broad) domains that never complete.
export const retrievalDomainHealth = pgTable(
  'RetrievalDomainHealth',
  {
    // canonical_subcategory of the domain (matches generatedQuestions.canonicalSubcategory).
    domain: text('domain').primaryKey(),
    consecutiveTimeouts: integer('consecutive_timeouts').notNull().default(0),
    lastTimeoutAt: timestamp('last_timeout_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('RetrievalDomainHealth_cooldown_idx').on(table.consecutiveTimeouts, table.lastTimeoutAt),
  ],
);

// Global near-ness tree cache (migration 0099, D-NEARNESS-LADDER-HYBRID-01 B2).
// Structural, player-independent domain relations: for a child_domain, the
// related_domains one step away by rung (sibling/cousin/parent/grandparent),
// source-tagged (curated | llm). Computed once per domain by a lazy Haiku call on
// the shared thinness boundary; read by supply (route to held near rungs) and
// expansion (offer unheld near rungs). NB: rows are keyed on canonical_subcategory
// strings — a domain merge/rename must rewrite them (add to the merge routine).
export const domainRelations = pgTable(
  'DomainRelation',
  {
    id: id(),
    childDomain: text('child_domain').notNull(),
    relatedDomain: text('related_domain').notNull(),
    broadCategory: text('broad_category'),
    rung: text('rung').$type<'sibling' | 'cousin' | 'parent' | 'grandparent'>().notNull(),
    source: text('source').$type<'curated' | 'llm'>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('DomainRelation_child_related_key').on(table.childDomain, table.relatedDomain),
    index('DomainRelation_child_domain_idx').on(table.childDomain),
  ],
);

// B-KNOWLEDGE-TAXONOMY-01 P1 (migration 0102) — the leaf/parent knowledge
// graph (D-KNOWLEDGE-TAXONOMY-MODEL-01). Structure only, human-authored
// (B-KNOWLEDGE-ADMIN-01 populates it); dark until KNOWLEDGE_GRAPH_* flags.
// domainKey is UNIQUE — the anti-fragmentation tripwire: a label folding onto
// an existing node surfaces that node, never mints a sibling. A node can be
// leaf AND parent ('both' — Bach is masterable and parent of WTC, §3).
// masteryThreshold is the human-set absolute bar (§5); NULL → code default.
export const knowledgeNodes = pgTable(
  'KnowledgeNode',
  {
    id: id(),
    label: text('label').notNull(),
    domainKey: text('domain_key').notNull(),
    nodeKind: text('node_kind').$type<'leaf' | 'parent' | 'both'>().notNull().default('leaf'),
    masteryThreshold: integer('mastery_threshold'),
    broadCategory: text('broad_category'),
    fieldHue: text('field_hue'),
    // Wikidata provenance (ADMIN-01 P3): the QID this node was ratified from.
    // NULL for manually-authored / LLM-proposed nodes.
    wikidataQid: text('wikidata_qid'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('KnowledgeNode_domain_key_key').on(table.domainKey)],
);

// Child→parent containment membership. Every edge is depth-eligible credit
// (you understand the subject) — the substantive/collection distinction was
// dropped 2026-07-04 (migration 0110; prod had 0 collection edges). Deliberately
// SEPARATE from DomainRelation above — that is the serving-side near-ness cache
// keyed on raw canonical_subcategory strings; this is the authored taxonomy keyed
// on domainKey. Keyed by domain_key, not node id, so edges survive label edits.
export const knowledgeEdges = pgTable(
  'KnowledgeEdge',
  {
    id: id(),
    childDomainKey: text('child_domain_key').notNull(),
    parentDomainKey: text('parent_domain_key').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('KnowledgeEdge_child_parent_key').on(table.childDomainKey, table.parentDomainKey),
    index('KnowledgeEdge_parent_domain_key_idx').on(table.parentDomainKey),
    index('KnowledgeEdge_child_domain_key_idx').on(table.childDomainKey),
  ],
);

// B-KNOWLEDGE-TAXONOMY-01 P4 (migration 0104) — the parent-mastery freeze
// ledger (D-doc §B). A row = the moment a player crossed a substantive
// parent's bar; mastery is terminal from then on — roster growth or threshold
// edits never re-open it. Derived progress lives at read time; only the
// crossing is stored. Dark until KNOWLEDGE_GRAPH_MASTERY.
export const knowledgeParentMastery = pgTable(
  'KnowledgeParentMastery',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    parentDomainKey: text('parent_domain_key').notNull(),
    masteredAt: timestamp('mastered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('KnowledgeParentMastery_user_parent_key').on(table.userId, table.parentDomainKey),
    index('KnowledgeParentMastery_user_id_idx').on(table.userId),
  ],
);

// Mastery v2 (migration 0111) — the LEAF-mastery freeze ledger, the grain
// inversion of KnowledgeParentMastery (docs/thinking/MASTERY-MODEL-v2.md,
// decision 3). A row = the moment a player permanently mastered a leaf. Leaf
// mastery is terminal; parent mastery, by contrast, is computed LIVE and never
// frozen. Dark until KNOWLEDGE_MASTERY_V2.
export const knowledgeLeafMastery = pgTable(
  'KnowledgeLeafMastery',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    leafDomainKey: text('leaf_domain_key').notNull(),
    masteredAt: timestamp('mastered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('KnowledgeLeafMastery_user_leaf_key').on(table.userId, table.leafDomainKey),
    index('KnowledgeLeafMastery_user_id_idx').on(table.userId),
  ],
);

export const questionFeedback = pgTable(
  'QuestionFeedback',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    questionId: text('question_id').references(() => questions.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id),
    signal: feedbackSignalEnum('signal').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('QuestionFeedback_generated_question_id_key').on(table.generatedQuestionId),
    unique('QuestionFeedback_user_id_question_id_key').on(table.userId, table.questionId),
    unique('QuestionFeedback_user_id_generated_question_id_key').on(
      table.userId,
      table.generatedQuestionId,
    ),
    index('QuestionFeedback_user_id_idx').on(table.userId),
    index('QuestionFeedback_question_id_idx').on(table.questionId),
  ],
);

export const questionRatings = pgTable(
  'QuestionRating',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    rating: text('rating').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique('QuestionRating_user_id_question_id_key').on(table.userId, table.questionId),
    index('QuestionRating_user_id_idx').on(table.userId),
    index('QuestionRating_question_id_idx').on(table.questionId),
  ],
);

export const contentReports = pgTable(
  'ContentReport',
  {
    id: id(),
    reporterUserId: text('reporter_user_id')
      .notNull()
      .references(() => users.id),
    questionId: text('question_id').references(() => questions.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id),
    category: contentReportCategoryEnum('category').notNull(),
    incorrectKind: contentReportIncorrectKindEnum('incorrect_kind'),
    note: text('note').notNull(),
    suggestedAnswer: text('suggested_answer'),
    surface: text('surface'),
    status: contentReportStatusEnum('status').notNull().default('open'),
    reviewDecision: text('review_decision'),
    reviewReason: text('review_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('ContentReport_reporter_user_id_idx').on(table.reporterUserId),
    index('ContentReport_question_id_idx').on(table.questionId),
    index('ContentReport_generated_question_id_idx').on(table.generatedQuestionId),
    index('ContentReport_status_idx').on(table.status),
    check(
      'ContentReport_one_target',
      sql`(question_id IS NOT NULL)::int + (generated_question_id IS NOT NULL)::int = 1`,
    ),
    check(
      'ContentReport_incorrect_kind_scope',
      sql`incorrect_kind IS NULL OR category = 'incorrect'`,
    ),
    // One open report per user per target. The target is split across two
    // nullable columns, so the single-COALESCE form Drizzle can't express
    // becomes two partial unique indexes — each scoped to its own column and
    // to status = 'open', mirroring feed_dismissed_domains_active_unique. A
    // fresh report is allowed once a prior one leaves 'open' (re-report policy).
    uniqueIndex('ContentReport_one_open_per_question')
      .on(table.reporterUserId, table.questionId)
      .where(sql`status = 'open' AND question_id IS NOT NULL`),
    uniqueIndex('ContentReport_one_open_per_generated_question')
      .on(table.reporterUserId, table.generatedQuestionId)
      .where(sql`status = 'open' AND generated_question_id IS NOT NULL`),
  ],
);

export const dailyQueues = pgTable(
  'DailyQueue',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    queueDate: date('queue_date').notNull(),
    slots: jsonb('slots').notNull(),
    createdAt: createdAt(),
    // Set when the daily reminder email has been sent for this queue (one row
    // per user/day). Claimed atomically before send so the cron's retry-replay
    // can't double-send; null = not yet sent, or released back to null after a
    // send failure so a later run can retry.
    emailReminderSentAt: timestamp('email_reminder_sent_at', { withTimezone: true }),
    // Independent from the email marker: each channel owns its own atomic
    // per-user/day claim and can be retried without double-sending the other.
    smsReminderSentAt: timestamp('sms_reminder_sent_at', { withTimezone: true }),
  },
  (table) => [
    unique('DailyQueue_user_id_queue_date_key').on(table.userId, table.queueDate),
    index('DailyQueue_user_id_idx').on(table.userId),
  ],
);

export const dailyPreferences = pgTable(
  'DailyPreference',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    friendIds: text('friend_ids').array().notNull().default(textArrayDefault),
    includeCommunity: boolean('include_community').notNull().default(false),
    difficulty: text('difficulty').notNull().default('adaptive'),
    domainMode: text('domain_mode').notNull().default('random'),
    selectedDomains: jsonb('selected_domains').$type<string[]>().notNull().default([]),
    domainPreferenceFrequency: jsonb('domain_preference_frequency')
      .$type<Record<string, 'often' | 'sometimes' | 'blue_moon' | 'resting'>>()
      .notNull()
      .default({}),
    difficultyPreference: text('difficulty_preference').notNull().default('normal'),
    /**
     * D-MISSED-RETURN-01 §7-B1/§7-F1 — the single on/off toggle governing BOTH
     * return scopes (expired + wrong) together. Default TRUE: on for everyone,
     * existing and new alike.
     *
     * Read it through `isMissedReturnEnabledForUser`, never directly: a user with
     * no DailyPreference row at all must also read as ON, and a raw join would
     * silently make "never opened Customize" mean "opted out".
     */
    missedReturnEnabled: boolean('missed_return_enabled').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('DailyPreference_user_id_key').on(table.userId),
    index('DailyPreference_user_id_idx').on(table.userId),
  ],
);

export const skippedDailyQuestions = pgTable(
  'SkippedDailyQuestion',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    queueId: text('queue_id')
      .notNull()
      .references(() => dailyQueues.id, { onDelete: 'cascade' }),
    questionId: text('question_id').references(() => questions.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    skippedAt: timestamp('skipped_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('SkippedDailyQuestion_user_id_idx').on(table.userId),
    index('SkippedDailyQuestion_user_id_question_id_idx').on(table.userId, table.questionId),
    index('SkippedDailyQuestion_user_id_generated_question_id_idx').on(
      table.userId,
      table.generatedQuestionId,
    ),
    index('SkippedDailyQuestion_queue_id_idx').on(table.queueId),
    // Standalone covering indexes for the question_id / generated_question_id
    // FKs (0083 / advisor 0001). The composites above lead with user_id, so they
    // can't serve a lookup/FK-check on the question columns alone.
    index('SkippedDailyQuestion_question_id_idx').on(table.questionId),
    index('SkippedDailyQuestion_generated_question_id_idx').on(table.generatedQuestionId),
  ],
);

/**
 * A question the player has permanently hidden ("Never show this question
 * again" in the Not-for-me sheet). Distinct from SkippedDailyQuestion in two
 * ways that matter:
 *
 *  - No `queue_id`. A skip is scoped to the round it happened in and cascades
 *    away with its queue; a hide is a durable preference that must outlive
 *    every queue it was ever served in.
 *  - It is REVERSIBLE by design. "Hidden questions" in settings lists these
 *    rows and restoring one deletes it, so nothing is burned irrecoverably.
 *    That reversibility is what makes permanent hiding acceptable against a
 *    finite question pool (D-SUPPLY-FINITE-SET-01) -- a player who hides a
 *    question by accident can always get it back.
 *
 * Exactly one of question_id / generated_question_id is set, mirroring how
 * SkippedDailyQuestion addresses the two question sources.
 */
export const hiddenQuestions = pgTable(
  'HiddenQuestion',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    questionId: text('question_id').references(() => questions.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('HiddenQuestion_user_id_idx').on(table.userId),
    index('HiddenQuestion_user_id_question_id_idx').on(table.userId, table.questionId),
    index('HiddenQuestion_user_id_generated_question_id_idx').on(
      table.userId,
      table.generatedQuestionId,
    ),
    // Standalone covering indexes for the two FKs, same rationale as
    // SkippedDailyQuestion's (0083 / advisor 0001): the composites lead with
    // user_id and can't serve an FK check on the question columns alone.
    index('HiddenQuestion_question_id_idx').on(table.questionId),
    index('HiddenQuestion_generated_question_id_idx').on(table.generatedQuestionId),
  ],
);

export const userDomainDifficulties = pgTable(
  'USER_DOMAIN_DIFFICULTY',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    servedDifficulty: difficultyEstimateEnum('served_difficulty').notNull(),
    consecutiveCorrect: integer('consecutive_correct').notNull().default(0),
    consecutiveIncorrect: integer('consecutive_incorrect').notNull().default(0),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    // Refine Your Game "Ease off": while this is in the future the served
    // difficulty is pinned — updateDomainDifficultyOnAnswer() skips the step.
    // NULL means no freeze (normal adaptive behavior).
    freezeUntil: timestamp('freeze_until', { withTimezone: true }),
    // Expansion offer (post-daily-Five "you're crushing X — branch out?"). Set by
    // the supply-side correction when a player tops the ladder yet still out-runs a
    // domain's available content; the daily summary surfaces the offer while this
    // is set and expansionOfferedAt is NULL. NULL means no pending offer.
    expansionEligibleSince: timestamp('expansion_eligible_since', { withTimezone: true }),
    // Stamped when the expansion offer was accepted or dismissed, so it shows once.
    expansionOfferedAt: timestamp('expansion_offered_at', { withTimezone: true }),
  },
  (table) => [
    unique('USER_DOMAIN_DIFFICULTY_user_id_canonical_subcategory_key').on(
      table.userId,
      table.canonicalSubcategory,
    ),
    index('USER_DOMAIN_DIFFICULTY_user_id_idx').on(table.userId),
  ],
);

export const userDomainExclusions = pgTable(
  'USER_DOMAIN_EXCLUSIONS',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    scope: domainExclusionScopeEnum('scope').notNull().default('subcategory'),
    excludedAt: timestamp('excluded_at', { withTimezone: true }).notNull().defaultNow(),
    // D-DOMAIN-REST-01: a temporary "Rest" pulls a domain out of circulation
    // until this instant, then it returns on its own (expiry is evaluated at
    // read time in getExcludedKnowledgeDomains — no cron). NULL = a permanent
    // exclusion (the "Mute"/"Never appear" semantics), which is the default.
    restUntil: timestamp('rest_until', { withTimezone: true }),
  },
  (table) => [
    unique('USER_DOMAIN_EXCLUSIONS_user_id_scope_canonical_subcategory_key').on(
      table.userId,
      table.scope,
      table.canonicalSubcategory,
    ),
  ],
);

// Decision + cooldown ledger for the Refine Your Game section on the daily
// summary. One row per refine item the player acted on (or that was shown and
// defaulted). `action` moves pending -> committed | defaulted; staged changes
// apply at next-daily build (src/server/refine/commit.ts), which is also when
// `cooldownUntil` is stamped. See drizzle/0063_daily_refine_decision.sql.
export const dailyRefineDecisions = pgTable(
  'DAILY_REFINE_DECISION',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    queueId: text('queue_id')
      .notNull()
      .references(() => dailyQueues.id, { onDelete: 'cascade' }),
    // 'friend_expansion' | 'difficulty_escalation' | 'struggle_pruning'
    itemType: text('item_type').notNull(),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    // Set only for friend_expansion (the bonus source friend).
    friendId: text('friend_id'),
    // 'pending' | 'committed' | 'defaulted'
    action: text('action').notNull().default('pending'),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // COALESCE(friend_id,'') in the unique index keeps the upsert key stable
    // for non-expansion rows; expressed in SQL (drizzle/0063), not modeled here.
    index('DAILY_REFINE_DECISION_cooldown_idx').on(
      table.userId,
      table.itemType,
      table.canonicalSubcategory,
      table.cooldownUntil,
    ),
    index('DAILY_REFINE_DECISION_uncommitted_idx').on(table.userId, table.committedAt),
    // Covering index for the queue_id FK (0083 / advisor 0001).
    index('DAILY_REFINE_DECISION_queue_id_idx').on(table.queueId),
  ],
);

export const profileSectionVisibility = pgTable(
  'PROFILE_SECTION_VISIBILITY',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    section: profileSectionEnum('section').notNull(),
    visibility: text('visibility')
      .$type<'public' | 'friends' | 'private'>()
      .notNull()
      .default('public'),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('PROFILE_SECTION_VISIBILITY_user_id_section_key').on(table.userId, table.section),
    index('PROFILE_SECTION_VISIBILITY_user_id_idx').on(table.userId),
    check(
      'PROFILE_SECTION_VISIBILITY_visibility_check',
      sql`${table.visibility} IN ('public', 'friends', 'private')`,
    ),
  ],
);

export const profileDomainVisibility = pgTable(
  'PROFILE_DOMAIN_VISIBILITY',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    domain: text('domain').notNull(),
    visibility: text('visibility')
      .$type<'public' | 'friends' | 'private'>()
      .notNull()
      .default('public'),
    isVisible: boolean('is_visible').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('PROFILE_DOMAIN_VISIBILITY_user_id_canonical_subcategory_key').on(
      table.userId,
      table.canonicalSubcategory,
    ),
    uniqueIndex('PROFILE_DOMAIN_VISIBILITY_user_id_domain_key').on(table.userId, table.domain),
    index('PROFILE_DOMAIN_VISIBILITY_user_id_idx').on(table.userId),
    check(
      'PROFILE_DOMAIN_VISIBILITY_visibility_check',
      sql`${table.visibility} IN ('public', 'friends', 'private')`,
    ),
  ],
);

export const declaredInterests = pgTable(
  'DeclaredInterest',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
    broadCategory: text('broadCategory'),
    declaredAt: timestamp('declaredAt', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('isActive').notNull().default(true),
  },
  (table) => [
    unique('DeclaredInterest_userId_domain_key').on(table.userId, table.domain),
    index('DeclaredInterest_userId_isActive_idx').on(table.userId, table.isActive),
  ],
);

// B-CRAFTER-LIFECYCLE-01 Phase 3 (0101) — the manual "invitation to author"
// checkbox. A crafter flips a per-(player, domain) invitation from Panel B; the
// player sees the full-screen completion takeover ONCE (seenAt), picks a door
// (doorChoice: 'author' | 'expand' | 'wait'), and the invitation also gates the
// player's access to the creation surface for that domain. reason keeps this
// generic — 'domain_exhausted' is the first of a couple of invitation
// categories. resolvedAt closes without deleting; one ACTIVE row per
// (user, domain) via the partial unique index.
export const authorInvitations = pgTable(
  'AuthorInvitation',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    domain: text('domain').notNull(),
    reason: text('reason').notNull().default('domain_exhausted'),
    // Nullable since 0114: a set-completion invitation is system-created and has
    // no human inviter (NULL = automatic). Human crafter invites still set it.
    invitedBy: text('invited_by').references(() => users.id),
    createdAt: createdAt(),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    doorChoice: text('door_choice'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('AuthorInvitation_active_user_domain_key')
      .on(table.userId, table.domain)
      .where(sql`${table.resolvedAt} IS NULL`),
    index('AuthorInvitation_user_id_idx').on(table.userId),
  ],
);

// B-CRAFTER-DECISION-LEDGER-01 — every keep/kill verdict a human passes on a
// machine draft candidate, recorded durably so (a) the draft prompt can learn
// the human's bar in-context (kept exemplars, killed anti-exemplars — see
// draft-candidates.ts) and (b) the machine's own doubts can be graded against
// the human verdicts (flags vs decision = gate calibration). Kills previously
// evaporated as client-side state; this ledger is the durable half of "the
// machine learns from you". Rows are append-only teaching data — never served,
// never joined into play paths.
export const crafterDraftDecisions = pgTable(
  'CrafterDraftDecision',
  {
    id: id(),
    deciderId: text('decider_id')
      .notNull()
      .references(() => users.id),
    domain: text('domain').notNull(),
    tier: text('tier').$type<'shallow' | 'deep'>().notNull(),
    questionText: text('question_text').notNull(),
    answer: text('answer').notNull(),
    decision: text('decision').$type<'kept' | 'killed'>().notNull(),
    // The machine's doubts as shown at decision time ({kind, note} pairs) —
    // a kill WITHOUT flags and a keep DESPITE flags are both gate corrections.
    flags: jsonb('flags').$type<Array<{ kind: string; note: string }>>().notNull().default([]),
    // On a keep where the human corrected the machine's answer.
    editedAnswer: text('edited_answer'),
    // The Question a keep created (null for kills).
    questionId: text('question_id').references(() => questions.id),
    createdAt: createdAt(),
  },
  (table) => [
    index('CrafterDraftDecision_domain_idx').on(table.domain),
    index('CrafterDraftDecision_decider_id_idx').on(table.deciderId),
  ],
);

// D-QUALITY-SALVAGE-01: a machine-proposed minimal fix for a verifier-demoted
// question, pre-re-verified, awaiting a human's one-click approval in the review
// queue. Never applied automatically — approving copies the proposed text into
// the real edit/approve path. Append-only-ish: one live ('ready') proposal per
// question; superseded/decided proposals keep their terminal status for record.
export const questionSalvageProposals = pgTable(
  'QuestionSalvageProposal',
  {
    id: id(),
    // The demoted row's id, in whichever store it lives (see targetTable).
    questionId: text('question_id').notNull(),
    targetTable: text('target_table').$type<'question' | 'generated'>().notNull(),
    kind: text('kind')
      .$type<'extra_fact_stem' | 'extra_fact_explainer' | 'unsalvageable'>()
      .notNull(),
    proposedStem: text('proposed_stem'),
    proposedExplanation: text('proposed_explanation'),
    // Outcome of re-verifying the PROPOSED version. A proposal is only surfaced
    // when this is 'ok' — the human never sees a fix that didn't actually pass.
    reverifyOutcome: text('reverify_outcome').$type<'ok' | 'demoted' | 'unverifiable'>().notNull(),
    reverifyReason: text('reverify_reason'),
    status: text('status')
      .$type<'ready' | 'applied' | 'rejected' | 'unsalvageable'>()
      .notNull()
      .default('ready'),
    createdAt: createdAt(),
  },
  (table) => [
    index('QuestionSalvageProposal_question_id_idx').on(table.questionId),
    // At most one live proposal per question — a re-run supersedes, not stacks.
    uniqueIndex('QuestionSalvageProposal_active_question_key')
      .on(table.questionId)
      .where(sql`${table.status} = 'ready'`),
  ],
);

export const friendships = pgTable(
  'Friendship',
  {
    id: id(),
    userAId: text('userAId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: text('userBId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    requestedByUserId: text('requestedByUserId')
      .notNull()
      .references(() => users.id),
    formedVia: text('formedVia').notNull(),
    formedAt: timestamp('formedAt', { withTimezone: true }),
    removedAt: timestamp('removedAt', { withTimezone: true }),
    removedByUserId: text('removedByUserId').references(() => users.id),
    requestContext: jsonb('requestContext').$type<{ suggestedInterests?: string[] }>(),
    personalNote: text('personalNote'),
    expiresAt: timestamp('expiresAt', { withTimezone: true }),
    resolvedAt: timestamp('resolvedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('Friendship_userAId_userBId_key').on(table.userAId, table.userBId),
    index('Friendship_userAId_status_idx').on(table.userAId, table.status),
    index('Friendship_userBId_status_idx').on(table.userBId, table.status),
    // Covering indexes for the requestedByUserId / removedByUserId FKs
    // (0083 / advisor 0001).
    index('Friendship_requestedByUserId_idx').on(table.requestedByUserId),
    index('Friendship_removedByUserId_idx').on(table.removedByUserId),
  ],
);

// D-1 Stage 3 — directional follow edges. Two rows model a mutual ("friend")
// relationship; one row models a one-directional follow. The follower is always
// the requester, so there is no separate requestedByUserId. Unfollow is a hard
// delete (no `removed` state). `friendships` is frozen and kept for rollback;
// all relationship reads/writes go through this table.
export const follows = pgTable(
  'Follow',
  {
    id: id(),
    followerId: text('followerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: text('followeeId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    state: followStateEnum('state').notNull().default('pending'),
    // Carried from the originating request so the incoming-request card can
    // still render a personal note and suggested interests.
    personalNote: text('personalNote'),
    requestContext: jsonb('requestContext').$type<{ suggestedInterests?: string[] }>(),
    createdAt: createdAt(),
    approvedAt: timestamp('approvedAt', { withTimezone: true }),
  },
  (table) => [
    unique('Follow_followerId_followeeId_key').on(table.followerId, table.followeeId),
    // "who I follow" + outbound pending; "my followers" + inbound pending.
    index('Follow_followerId_state_idx').on(table.followerId, table.state),
    index('Follow_followeeId_state_idx').on(table.followeeId, table.state),
    // Covering index for the friends-visibility EXISTS subquery on the
    // read-hot feed path (questionVisibilityPredicate, src/server/db/
    // queries/feed.ts): "does viewer follow this author with state=approved?".
    // The unique (followerId, followeeId) index above already pinpoints the
    // single row; adding state lets the approved check be answered index-only
    // (no heap visit) on every feed render.
    index('Follow_followerId_followeeId_state_idx').on(
      table.followerId,
      table.followeeId,
      table.state,
    ),
    check('Follow_distinct_users', sql`${table.followerId} <> ${table.followeeId}`),
  ],
);

export const contactHashes = pgTable(
  'ContactHash',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    phoneHash: text('phoneHash').notNull(),
    uploadedAt: timestamp('uploadedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.phoneHash] }),
    index('ContactHash_phoneHash_idx').on(table.phoneHash),
  ],
);

export const joshingGames = pgTable(
  'JoshingGame',
  {
    id: id(),
    title: text('title').notNull(),
    creatorId: text('creatorId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('JoshingGame_creatorId_idx').on(table.creatorId)],
);

export const feedItems = pgTable(
  'FeedItem',
  {
    id: id(),
    recipientUserId: text('recipientUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('questionId').references(() => questions.id),
    joshingGameId: text('joshingGameId').references(() => joshingGames.id, {
      onDelete: 'set null',
    }),
    sourceType: text('sourceType').notNull(),
    sourceUserId: text('sourceUserId')
      .notNull()
      .references(() => users.id),
    // D-4 via-attribution: the user the FORWARDER got this question from — two
    // hops above the recipient. Stamped at forward time in /api/questions/send as
    // the forwarder's own sourceUserId (no lineage propagation); NULL when the
    // forwarder authored it or got it organically (no inbound forward row).
    // Drives the "via {source}" stranger-discovery affordance, gated by the
    // via-person's discoverableByForward flag. ON DELETE set null so a deleted
    // via-user cleanly drops the attribution. See the D-4 amendment in
    // PRD-D-4-LATELY-MILESTONES-AND-PLUS2-REFRAME-SPEC.md.
    viaUserId: text('viaUserId').references(() => users.id, { onDelete: 'set null' }),
    sourceResult: text('sourceResult').$type<'correct' | 'incorrect' | null>(),
    sourceEventAt: timestamp('sourceEventAt', { withTimezone: true }).notNull().defaultNow(),
    personalMessage: text('personalMessage'),
    submittedAnswer: text('submittedAnswer'),
    answerResult: text('answerResult').$type<'correct' | 'incorrect'>(),
    // The time the recipient actually answered this card. Stamped at answer time
    // (feed/answer, lately/milestone/answer) and used as the answeredAt sort key
    // in the Answered archive (readFeedItems). Nullable: NULL means not yet
    // answered, or a pre-0085 answered row with no recoverable answer time — the
    // archive falls back to sourceEventAt for those.
    answeredAt: timestamp('answeredAt', { withTimezone: true }),
    pointsAwarded: doublePrecision('pointsAwarded'),
    masteryDelta: jsonb('masteryDelta').$type<Record<string, unknown> | null>(),
    sourceAnswerId: text('sourceAnswerId'),
    state: text('state').notNull().default('active'),
    isPinned: boolean('isPinned').notNull().default(false),
    catchupResolvedAt: timestamp('catchupResolvedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('FeedItem_recipientUserId_state_idx').on(
      table.recipientUserId,
      table.state,
      table.sourceEventAt.desc(),
    ),
    index('FeedItem_recipientUserId_pinned_idx')
      .on(table.recipientUserId, table.isPinned)
      .where(sql`"isPinned" = TRUE`),
    uniqueIndex('FeedItem_recipientUserId_sourceAnswerId_key')
      .on(table.recipientUserId, table.sourceAnswerId)
      .where(sql`"sourceAnswerId" IS NOT NULL`),
    // Covering indexes for hot-path foreign keys (B-PERF-03, migration 0079).
    index('FeedItem_questionId_idx').on(table.questionId),
    index('FeedItem_sourceUserId_idx').on(table.sourceUserId),
    index('FeedItem_joshingGameId_idx').on(table.joshingGameId),
    // Covering index for the viaUserId FK (mirrors the B-PERF-03 / 0079 treatment
    // of the other FeedItem FKs) so deleting a User doesn't seq-scan FeedItem.
    index('FeedItem_viaUserId_idx').on(table.viaUserId),
  ],
);

export const joshingGameRecipients = pgTable(
  'JoshingGameRecipient',
  {
    id: id(),
    gameId: text('gameId')
      .notNull()
      .references(() => joshingGames.id, { onDelete: 'cascade' }),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sentAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('JoshingGameRecipient_gameId_userId_key').on(table.gameId, table.userId),
    index('JoshingGameRecipient_userId_idx').on(table.userId),
    index('JoshingGameRecipient_gameId_idx').on(table.gameId),
  ],
);

export const joshingGameQuestions = pgTable(
  'JoshingGameQuestion',
  {
    id: id(),
    gameId: text('gameId')
      .notNull()
      .references(() => joshingGames.id, { onDelete: 'cascade' }),
    questionId: text('questionId')
      .notNull()
      .references(() => questions.id),
    position: integer('position').notNull(),
  },
  (table) => [
    unique('JoshingGameQuestion_gameId_position_key').on(table.gameId, table.position),
    unique('JoshingGameQuestion_gameId_questionId_key').on(table.gameId, table.questionId),
    // Covering index for the questionId FK (0083 / advisor 0001) — the
    // (gameId, questionId) unique above leads with gameId, so it can't serve a
    // lookup on questionId alone.
    index('JoshingGameQuestion_questionId_idx').on(table.questionId),
  ],
);

export const joshingGameResponses = pgTable(
  'JoshingGameResponse',
  {
    id: id(),
    gameId: text('gameId')
      .notNull()
      .references(() => joshingGames.id, { onDelete: 'cascade' }),
    questionId: text('questionId')
      .notNull()
      .references(() => questions.id),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    submittedAnswer: text('submittedAnswer'),
    isCorrect: boolean('isCorrect'),
    isPartial: boolean('isPartial').notNull().default(false),
    answerState: text('answerState'),
    pointsAwarded: doublePrecision('pointsAwarded'),
    answeredAt: timestamp('answeredAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('JoshingGameResponse_gameId_questionId_userId_key').on(
      table.gameId,
      table.questionId,
      table.userId,
    ),
    index('JoshingGameResponse_gameId_userId_idx').on(table.gameId, table.userId),
    index('JoshingGameResponse_userId_idx').on(table.userId),
    // Covering index for the questionId FK (0083 / advisor 0001).
    index('JoshingGameResponse_questionId_idx').on(table.questionId),
  ],
);

export const biweeklyCeremonies = pgTable(
  'BiweeklyCeremony',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cycleStart: date('cycleStart').notNull(),
    cycleEnd: date('cycleEnd').notNull(),
    firedAt: timestamp('firedAt', { withTimezone: true }).notNull().defaultNow(),
    viewedAt: timestamp('viewedAt', { withTimezone: true }),
    beatsPayload: jsonb('beatsPayload').notNull(),
    shareCardToken: text('shareCardToken'),
  },
  (table) => [
    uniqueIndex('BiweeklyCeremony_shareCardToken_key').on(table.shareCardToken),
    uniqueIndex('BiweeklyCeremony_user_cycle_key').on(
      table.userId,
      table.cycleStart,
      table.cycleEnd,
    ),
    index('BiweeklyCeremony_userId_firedAt_idx').on(table.userId, table.firedAt.desc()),
  ],
);

export const activityItems = pgTable(
  'ActivityItem',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorUserId: text('actorUserId').references(() => users.id, { onDelete: 'set null' }),
    referenceId: text('referenceId'),
    referenceType: text('referenceType'),
    read: boolean('read').notNull().default(false),
    deletedAt: timestamp('deletedAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ActivityItem_userId_read_idx').on(table.userId, table.read, table.createdAt.desc()),
    index('ActivityItem_userId_createdAt_idx').on(table.userId, table.createdAt.desc()),
    // Covering index for hot-path foreign key (B-PERF-03, migration 0079).
    index('ActivityItem_actorUserId_idx').on(table.actorUserId),
  ],
);

export const feedDismissedDomains = pgTable(
  'FeedDismissedDomain',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    canonicalSubcategory: text('canonicalSubcategory').notNull(),
    dismissedAt: timestamp('dismissedAt', { withTimezone: true }).notNull().defaultNow(),
    reinstatedAt: timestamp('reinstatedAt', { withTimezone: true }),
  },
  (table) => [
    index('FeedDismissedDomain_userId_idx').on(table.userId),
    index('FeedDismissedDomain_userId_sub_idx').on(table.userId, table.canonicalSubcategory),
    uniqueIndex('feed_dismissed_domains_active_unique')
      .on(table.userId, table.canonicalSubcategory)
      .where(sql`${table.reinstatedAt} IS NULL`),
  ],
);

// Per-user "set aside" for recovered-review questions (D-REVIEW-RECOVERED-01).
// A reversible soft-dismiss at the QUESTION level: an active row (reinstatedAt
// IS NULL) demotes that question to the bottom of the viewer's recovered list
// and dims it. Restoring sets reinstatedAt = now(); setting aside again inserts
// a fresh active row. Mirrors FeedDismissedDomain exactly (the partial unique
// index keeps at most one active row per (user, question)).
export const recoveredSetAside = pgTable(
  'RecoveredSetAside',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('questionId')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    setAsideAt: timestamp('setAsideAt', { withTimezone: true }).notNull().defaultNow(),
    reinstatedAt: timestamp('reinstatedAt', { withTimezone: true }),
  },
  (table) => [
    index('RecoveredSetAside_userId_idx').on(table.userId),
    uniqueIndex('recovered_set_aside_active_unique')
      .on(table.userId, table.questionId)
      .where(sql`${table.reinstatedAt} IS NULL`),
  ],
);

// Per-user "dismiss" for a From Friends milestone/streak question. A reversible
// soft-dismiss at the QUESTION level: an active row (reinstatedAt IS NULL) marks
// that the viewer has waved a friend's question off — it counts toward the
// bundle's played/consumed progress exactly like an answer (so a bundle whose
// questions are all answered-or-dismissed disappears), but it is deliberately
// NEUTRAL: it writes ONLY this row and touches nothing in the mastery/points
// system, so a dismiss never reads as a wrong answer. Undo sets reinstatedAt =
// now(); dismissing again inserts a fresh active row. Mirrors RecoveredSetAside
// / FeedDismissedDomain exactly (the partial unique index keeps at most one
// active row per (userId, questionId)).
export const milestoneDismissed = pgTable(
  'MilestoneDismissed',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('questionId')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissedAt', { withTimezone: true }).notNull().defaultNow(),
    reinstatedAt: timestamp('reinstatedAt', { withTimezone: true }),
  },
  (table) => [
    index('MilestoneDismissed_userId_idx').on(table.userId),
    uniqueIndex('milestone_dismissed_active_unique')
      .on(table.userId, table.questionId)
      .where(sql`${table.reinstatedAt} IS NULL`),
  ],
);

// Per-user "don't ask me this again" for the missed-question return system
// (D-MISSED-RETURN-01 §3.3). A reversible soft-dismiss at the QUESTION level:
// an active row (reinstatedAt IS NULL) makes the question permanently
// ineligible to return to the Daily Five as a return slot.
//
// WHY THIS EXISTS SEPARATELY from the catch-up dismiss it dual-writes with:
// catch-up's dismiss is SLOT-scoped — it stamps `dismissed_at` into that day's
// DailyQueue.slots JSONB, or feedItems.catchupResolvedAt. A return is by
// definition a NEW slot in a DIFFERENT queue, so a slot-level dismiss is
// invisible to it and a waved-off question would resurface days later. This
// table is the (userId, questionId) state that survives across queue instances.
//
// WHY IT IS NOT RecoveredSetAside: same shape, OPPOSITE meaning, and the rows
// must never be conflated (D-MISSED-RETURN-01 §3.1). RecoveredSetAside means
// "stop showing me this in the review deck" — a question I now KNOW. This means
// "stop asking me this" — a question I do NOT know and don't want back.
//
// Like MilestoneDismissed, a dismiss here is deliberately NEUTRAL: it writes
// ONLY this row and touches nothing in mastery/points, so it never reads as a
// wrong answer (D-MISSED-RETURN-01 §5). Undo sets reinstatedAt = now();
// dismissing again inserts a fresh active row. Mirrors RecoveredSetAside /
// MilestoneDismissed exactly (the partial unique index keeps at most one active
// row per (userId, questionId)).
//
// Note `questionId` FKs to Question — canonical questions only. LLM-origin
// daily questions live in GeneratedQuestion and are out of this feature's scope
// by construction (MASTERY_EVENTS.question_id is likewise null for them, so the
// Recovered pool excludes them too).
export const missedReturnDismissed = pgTable(
  'MissedReturnDismissed',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Exactly ONE of these is set (DB CHECK, migration 0130), mirroring
    // CatchupQueueItem.reportTarget and DailyQueue.slots — the two other places
    // that carry "a question" that may live in either table.
    questionId: text('questionId').references(() => questions.id, { onDelete: 'cascade' }),
    generatedQuestionId: text('generatedQuestionId').references(() => generatedQuestions.id, {
      onDelete: 'cascade',
    }),
    dismissedAt: timestamp('dismissedAt', { withTimezone: true }).notNull().defaultNow(),
    reinstatedAt: timestamp('reinstatedAt', { withTimezone: true }),
  },
  (table) => [
    index('MissedReturnDismissed_userId_idx').on(table.userId),
    // One ACTIVE row per (user, question) per kind. The IS NOT NULL guards
    // matter: without them the other kind's NULL column would collide.
    uniqueIndex('missed_return_dismissed_active_unique')
      .on(table.userId, table.questionId)
      .where(sql`${table.reinstatedAt} IS NULL AND ${table.questionId} IS NOT NULL`),
    uniqueIndex('missed_return_dismissed_generated_active_unique')
      .on(table.userId, table.generatedQuestionId)
      .where(sql`${table.reinstatedAt} IS NULL AND ${table.generatedQuestionId} IS NOT NULL`),
  ],
);

// Per-(user, question) return state for the missed-question return system
// (D-MISSED-RETURN-01 §4). Exactly two facts, both of which the eligibility rule
// needs and neither of which is derivable cheaply from anything else:
//
//   lastReturnedAt — enforces the 7-day floor between sightings (R5). A floor,
//                    not a schedule: nothing promises a return on day 8.
//   returnCount    — enforces the lifetime cap of 3 (R7). A question missed four
//                    times isn't teaching anything, so it is let go.
//
// One row per (userId, questionId), created on first return and updated in place
// — this is CURRENT STATE, not an event log (MASTERY_EVENTS already keeps the
// event history, and deriving these two values from it would mean scanning the
// whole log per candidate on every queue build).
//
// Deliberately NOT tracking retirement: R6's "stop on first correct" is already
// queryable as "has a first_correct_after_wrong event", which is the same
// predicate the shipped Recovered deck uses. No retiredAt column (§3.1).
//
// Per §2, the count is incremented for the WRONG scope only — an expired
// question's first appearance has never been seen, so it is a first ask arriving
// late, not a return.
export const missedReturnState = pgTable(
  'MissedReturnState',
  {
    id: id(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Exactly ONE of these is set (DB CHECK, migration 0130) — see the note on
    // MissedReturnDismissed above.
    questionId: text('questionId').references(() => questions.id, { onDelete: 'cascade' }),
    generatedQuestionId: text('generatedQuestionId').references(() => generatedQuestions.id, {
      onDelete: 'cascade',
    }),
    lastReturnedAt: timestamp('lastReturnedAt', { withTimezone: true }).notNull().defaultNow(),
    returnCount: integer('returnCount').notNull().default(0),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('MissedReturnState_userId_idx').on(table.userId),
    uniqueIndex('missed_return_state_user_question_unique')
      .on(table.userId, table.questionId)
      .where(sql`${table.questionId} IS NOT NULL`),
    uniqueIndex('missed_return_state_user_generated_unique')
      .on(table.userId, table.generatedQuestionId)
      .where(sql`${table.generatedQuestionId} IS NOT NULL`),
  ],
);

export const friendInvitations = pgTable(
  'FriendInvitation',
  {
    id: id(),
    inviterUserId: text('inviterUserId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteePhone: text('inviteePhone').notNull(),
    inviteeDisplayName: text('inviteeDisplayName'),
    inviteeUserId: text('inviteeUserId').references(() => users.id),
    preSeededInterests: jsonb('preSeededInterests'),
    personalMessage: text('personalMessage'),
    token: text('token').notNull(),
    sentAt: timestamp('sentAt', { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp('acceptedAt', { withTimezone: true }),
    cancelledAt: timestamp('cancelledAt', { withTimezone: true }),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('FriendInvitation_token_key').on(table.token),
    index('FriendInvitation_token_idx').on(table.token),
    index('FriendInvitation_inviterUserId_idx').on(table.inviterUserId),
    // Covering index for the inviteeUserId FK (0083 / advisor 0001).
    index('FriendInvitation_inviteeUserId_idx').on(table.inviteeUserId),
    index('FriendInvitation_inviteePhone_idx').on(table.inviteePhone),
    index('FriendInvitation_inviterUserId_inviteePhone_idx').on(
      table.inviterUserId,
      table.inviteePhone,
    ),
  ],
);

// B-FRIENDS-INVITE-LINKS-01 (2026-09-03) — up to 3 named invite links per
// user, replacing the single evergreen users.invite_token. slot is the
// identity a link carries: 0 = untagged (carries all 3 seed topics), 1-3 = a
// specific slot in the user's standing invite_seed_interests. slot is an
// INTEGER, not the topic label itself, so renaming a topic never orphans a
// link or changes its color — the UI resolves slot -> topic -> category at
// render time.
//
// Deletion is soft (deletedAt). A deleted link 404s immediately on
// /u/<handle>/<token>, but never touches the Follow edge upsertInvitationFriendship
// wrote on accept — nothing in a friendship references the token, so the
// people who already joined through a link stay friends after it's deleted.
// deletedAt also keeps the row (rather than a hard delete) so the join count
// stat survives and users.joined_via_invite_link_id attribution never dangles.
//
// The live-link cap (3) is enforced at the app layer (count non-deleted rows
// before insert), not here — expressing "at most 3 live rows per user" as a
// table constraint needs a trigger, which is more machinery than this needs.
export const userInviteLinks = pgTable(
  'UserInviteLink',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    slot: integer('slot').notNull().default(0),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('UserInviteLink_token_key').on(table.token),
    index('UserInviteLink_user_id_idx').on(table.userId),
    // A user can hold several untagged (slot 0) links at once, but at most one
    // LIVE link per named slot — tagging a second link with the same topic
    // would make "which link is Sondheim" ambiguous.
    uniqueIndex('UserInviteLink_user_id_slot_live_key')
      .on(table.userId, table.slot)
      .where(sql`${table.slot} <> 0 AND ${table.deletedAt} IS NULL`),
    check('UserInviteLink_slot_range', sql`${table.slot} BETWEEN 0 AND 3`),
  ],
);

// ─── LLM provider A/B switch (B-LLM-PROVIDER-AB-SWITCH B2) ────────────────────
// Single global row keyed by a fixed id ('singleton'); a CHECK pins the key so
// only one row can ever exist. Each of the four surfaces independently routes to
// 'anthropic' (default) or 'openai'. Read through the cached getProviderSettings()
// helper; written only by the owner via the /account LLM-provider panel. Test
// instrumentation — removable as a unit (drop this table, the helper, the panel).
export const appSettings = pgTable(
  'AppSettings',
  {
    id: text('id').primaryKey().default('singleton'),
    genProvider: text('gen_provider').notNull().default('anthropic'),
    categorizeProvider: text('categorize_provider').notNull().default('anthropic'),
    suggestProvider: text('suggest_provider').notNull().default('anthropic'),
    gradeProvider: text('grade_provider').notNull().default('anthropic'),
    updatedAt: updatedAt(),
  },
  () => [
    check('AppSettings_singleton', sql`id = 'singleton'`),
    check('AppSettings_gen_provider_valid', sql`gen_provider IN ('anthropic', 'openai')`),
    check(
      'AppSettings_categorize_provider_valid',
      sql`categorize_provider IN ('anthropic', 'openai')`,
    ),
    check('AppSettings_suggest_provider_valid', sql`suggest_provider IN ('anthropic', 'openai')`),
    check('AppSettings_grade_provider_valid', sql`grade_provider IN ('anthropic', 'openai')`),
  ],
);

// ─── LLM provider A/B metrics (B-LLM-PROVIDER-AB-METRICS) ─────────────────────
// Append-only log of every owner flip of the provider switch (Part 3), one row
// per surface that changed. Makes the experiment's comparison windows explicit:
// you can read exactly when grading/generation/etc. flipped. Written best-effort
// from the admin PATCH route after the AppSettings write. Removable as a unit.
export const llmProviderChangeLog = pgTable(
  'LlmProviderChangeLog',
  {
    id: id(),
    surface: text('surface').notNull(),
    fromProvider: text('from_provider').notNull(),
    toProvider: text('to_provider').notNull(),
    changedByUserId: text('changed_by_user_id'),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'LlmProviderChangeLog_surface_valid',
      sql`surface IN ('gen', 'categorize', 'suggest', 'grade')`,
    ),
    check('LlmProviderChangeLog_from_valid', sql`from_provider IN ('anthropic', 'openai')`),
    check('LlmProviderChangeLog_to_valid', sql`to_provider IN ('anthropic', 'openai')`),
    index('LlmProviderChangeLog_created_at_idx').on(table.createdAt),
  ],
);

// Per-call LLM usage events (Part 2 — cost). One row per completion (either
// provider) carrying the token counts already in the [llm] logs, but queryable.
// Cost is NOT stored — it's derived at read time from src/server/llm/pricing.ts
// so a repricing needs no backfill. Written best-effort/fire-and-forget off the
// LLM call's critical path; some rows may be lost on a cold cutoff (acceptable
// for an estimate). Removable as a unit.
export const llmUsageEvent = pgTable(
  'LlmUsageEvent',
  {
    id: id(),
    scope: text('scope').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreateTokens: integer('cache_create_tokens').notNull().default(0),
    // Anthropic server-side web_search request count (billed ~$0.01/request, a
    // separate meter from tokens). 0105 closes ledger gap (a) from
    // docs/findings/ledger-telemetry-gaps.md: refill + batch-verify search spend
    // was previously invisible to every ledger-derived $ number.
    webSearchRequests: integer('web_search_requests').notNull().default(0),
    // True when the call ran through the Message Batches API (0106; batch-verify
    // async mode) — tokens bill at 50%, and estimateCostUsd applies that discount
    // so the ledger doesn't over-report batch spend 2x.
    isBatch: boolean('is_batch').notNull().default(false),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (table) => [
    check('LlmUsageEvent_provider_valid', sql`provider IN ('anthropic', 'openai')`),
    index('LlmUsageEvent_provider_created_at_idx').on(table.provider, table.createdAt),
  ],
);

// D-FANDOM-GROUNDING-01 (0108): per-domain reference-passage cache — one row per
// canonical_subcategory, refreshed on a daily TTL (decision E). Feeds two
// consumers off ONE retrieval: the generation prompt's reference anchor
// (Consumer A, GENERATION_WIKI_ANCHOR_ENABLED) and — via the same source
// allowlist — the batch verifier's grounding (Consumer B). source='none' is a
// negative cache: retrieval ran and neither wiki covered the domain, so we
// don't re-bill the lookup until the TTL lapses. Passage text is grounding-only
// and never persisted into a served question (decision C; see
// questionLeaksPassageText). Removable as a unit with the flags.
export const domainReferencePassage = pgTable(
  'DomainReferencePassage',
  {
    id: id(),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    // 'wikipedia' (primary) | 'fandom' (deep-specialist fallback) | 'none'
    source: text('source').notNull(),
    passage: text('passage'),
    sourceUrl: text('source_url'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [
    check('DomainReferencePassage_source_valid', sql`source IN ('wikipedia', 'fandom', 'none')`),
    uniqueIndex('DomainReferencePassage_domain_key').on(table.canonicalSubcategory),
  ],
);

// D-DIFFICULTY-SIZE-COMPLETION-01 (0116): cached topic DEPTH SCORE (1-10), keyed
// on the folded domain_key so it covers every played canonical_subcategory, not
// just the few authored KnowledgeNodes. Set-completion derives a depth-sized
// target question count from this at read time (count = coefficient x depth^2),
// so the target curve is env-tunable with no re-seed. depth_score NULL is a
// negative cache (sizing ran, LLM returned nothing → readers use the default
// depth). One row per domain_key. Removable as a unit.
export const domainDepthEstimates = pgTable(
  'DomainDepthEstimate',
  {
    id: id(),
    domainKey: text('domain_key').notNull(),
    // 1-10 breadth/depth (scoreDomainDepth). NULL = negative cache.
    depthScore: integer('depth_score'),
    // A canonical_subcategory that folded to this key — for debugging only.
    sampleLabel: text('sample_label'),
    // 'llm' (depth scored) | 'default' (LLM unavailable) | 'corpus' (0117: resolved
    // + counted against a real Wikipedia/Wikidata/Fandom anchor).
    source: text('source').notNull().default('llm'),
    // Corpus-grounded size (0117, D-SUPPLY-FINITENESS-01). estimatedQuestions is
    // the number getTargetQuestionCountForDomains PREFERS over coefficient·depth²
    // when present; the rest record the resolution for the coverage dashboard +
    // the confidence-gated discrepancy alarm. All nullable — absent → depth fallback.
    estimatedQuestions: integer('estimated_questions'),
    corpusCount: integer('corpus_count'),
    shape: text('shape'),
    confidence: text('confidence'),
    basis: text('basis'),
    wikipediaTitle: text('wikipedia_title'),
    wikidataQid: text('wikidata_qid'),
    fandomHost: text('fandom_host'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    // Admin override (0119): when set, WINS over estimated_questions and the
    // depth fallback everywhere the estimate is read. Own column so resolver
    // re-runs / co-calibration never clobber it; NULL = no override.
    manualEstimatedQuestions: integer('manual_estimated_questions'),
    // Co-calibration stamp (0119): last time the raise_estimate loop lifted
    // estimated_questions to observed yield. Observability only.
    calibratedAt: timestamp('calibrated_at', { withTimezone: true }),
    // Admin generation cap (0121): when set, this domain is EXCLUDED from fresh
    // generation everywhere the daily generator builds its round palette (cron
    // build + demand-pull replenish) — the system stops searching it for new
    // facts. Serving is untouched (existing bank still flows) and it never fires
    // the discrepancy alarm. Distinct from the derived soft_finite state and the
    // per-player 'resting' tag: a global, deliberate, human stop. NULL = not capped.
    generationCappedAt: timestamp('generation_capped_at', { withTimezone: true }),
    // Dry-round observations (0118, D-SUPPLY-FINITENESS-01 #4). Raw counters
    // only — the supply STATE is derived at read time by classifySupplyState
    // (src/server/daily/supply-state.ts), so nothing stored can go stale.
    consecutiveDryRounds: integer('consecutive_dry_rounds').notNull().default(0),
    lastYieldAt: timestamp('last_yield_at', { withTimezone: true }),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('DomainDepthEstimate_domain_key').on(table.domainKey)],
);

// ReviewedDomainPair (0122, D-DOMAIN-MERGE-REVIEW-REDESIGN-01): permanent
// "Dismiss" record for the domain-merge review surface. pair_key is the two
// domains' folded domain_key values sorted + '::'-joined (order-independent,
// rename-surviving — see reviewedPairKey). getDomainFragmentationCandidates
// excludes any pair whose key sits here, so a dismissed pair never resurfaces
// after a similarity recompute. domain_a/domain_b are display spellings only.
export const reviewedDomainPairs = pgTable('ReviewedDomainPair', {
  pairKey: text('pair_key').primaryKey(),
  domainA: text('domain_a').notNull(),
  domainB: text('domain_b').notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
});

// Batch-verify async mode (0106): one row per Anthropic Message Batch of
// verification requests submitted by /api/cron/batch-verify-questions when
// BATCH_VERIFY_ASYNC_ENABLED is on. The daily cron harvests 'submitted' runs
// (applying verdicts + stamping question rows) before submitting a new batch.
// Rows inside an errored/expired batch result stay UNSTAMPED, so the next
// submission re-picks them — the same fail-open contract as the sync path.
// Removable as a unit with the flag.
export const verifyBatchRun = pgTable(
  'VerifyBatchRun',
  {
    id: id(),
    providerBatchId: text('provider_batch_id').notNull(),
    status: text('status').notNull().default('submitted'),
    requestCount: integer('request_count').notNull().default(0),
    harvestedAt: timestamp('harvested_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    check('VerifyBatchRun_status_valid', sql`status IN ('submitted', 'harvested', 'failed')`),
    uniqueIndex('VerifyBatchRun_provider_batch_id_key').on(table.providerBatchId),
    index('VerifyBatchRun_status_idx').on(table.status),
  ],
);

// B-LLM-COST-LATENCY-REPORT-01 — stored weekly cost & latency digest. One row
// per run of /api/cron/llm-cost-report, holding the plain-English markdown the
// owner reads. The digest is assembled from LlmUsageEvent rows at write time;
// cost stays read-time-derived (pricing.ts), so the markdown reflects the price
// map in effect when the cron ran. Read-and-report-only — nothing here is on the
// LLM call path. Removable as a unit.
export const llmCostReport = pgTable(
  'LlmCostReport',
  {
    id: id(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    windowDays: integer('window_days').notNull().default(7),
    markdown: text('markdown').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('LlmCostReport_created_at_idx').on(table.createdAt)],
);

// B-QUESTION-QUALITY-AGENTS-01 Phase 4 — stored weekly quality-aggregation digest.
// Mirrors LlmCostReport: one row per generated digest, the rendered markdown is the
// durable artifact. Read-and-report only (no LLM on this path in v1).
export const qualityReport = pgTable(
  'QualityReport',
  {
    id: id(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    windowDays: integer('window_days').notNull().default(30),
    markdown: text('markdown').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('QualityReport_created_at_idx').on(table.createdAt)],
);

// 0120: daily counters for the generation-time gate chain (quality, factual,
// dedup, cooldowns, thin-declared). Every gate in that chain FAILS OPEN by
// design (an LLM outage must not block the daily queue), which means a gate
// can be silently disabled — timing out, truncating, or erroring on every
// call — and nothing surfaces it. These counters make that visible: the
// weekly quality digest reads them and renders per-gate drop rates plus
// failed-open run counts. One row per (UTC day, gate), incremented
// fire-and-forget from the gate chain; a write failure never blocks
// generation. Coarse by design — no per-question rows, no user linkage.
export const gateDropStat = pgTable(
  'GateDropStat',
  {
    id: id(),
    day: date('day').notNull(),
    gate: text('gate').notNull(),
    /** Questions the gate saw (batch sizes summed across runs). */
    considered: integer('considered').notNull().default(0),
    /** Questions the gate dropped. */
    dropped: integer('dropped').notNull().default(0),
    /** Runs where the gate errored/timed out and passed everything unchecked. */
    failedOpen: integer('failed_open').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [unique('GateDropStat_day_gate_unique').on(table.day, table.gate)],
);

// D-MASTERY-FINEST-NODE-01 observability — one daily snapshot of the mastery-v2
// calibration picture, captured in SHADOW (computed via the pure resolveV2Mastery
// without enabling KNOWLEDGE_MASTERY_V2 or writing the freeze ledger). `metrics`
// holds the structured aggregate (reachability buckets, v1↔v2 badge divergence,
// per-node headroom, threshold-vs-supply classification, flip-readiness verdict)
// so trends chart without re-parsing markdown; `markdown` is the rendered digest
// (identical to the email body). One row per UTC day, replaced on a same-day re-run.
export const masteryCalibrationSnapshot = pgTable(
  'MasteryCalibrationSnapshot',
  {
    id: id(),
    day: date('day').notNull(),
    // Was KNOWLEDGE_MASTERY_V2 actually live when captured? false = pure shadow.
    flagEnabled: boolean('flag_enabled').notNull().default(false),
    metrics: jsonb('metrics').notNull(),
    markdown: text('markdown').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('MasteryCalibrationSnapshot_day_unique').on(table.day),
    index('MasteryCalibrationSnapshot_day_idx').on(table.day),
  ],
);
