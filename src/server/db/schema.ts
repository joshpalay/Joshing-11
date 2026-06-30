import { sql } from 'drizzle-orm';

import type { QuestionSource } from '@/lib/questions-types';
import {
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

const id = (name = 'id') => text(name).primaryKey().default(sql`gen_random_uuid()::text`);
const createdAt = (name = 'created_at') => timestamp(name, { withTimezone: true }).notNull().defaultNow();
const updatedAt = (name = 'updated_at') => timestamp(name, { withTimezone: true }).notNull().defaultNow();
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
export const questionVisibilityEnum = pgEnum('QuestionVisibility', ['private', 'public', 'friends', 'blocked']);

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
export const answerSourceEnum = pgEnum('AnswerSource', ['llm_suggested', 'creator_written', 'llm_edited']);
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
export const subscriptionPlanEnum = pgEnum('SubscriptionPlan', ['free', 'plus_monthly', 'plus_yearly']);
export const masteryTierEnum = pgEnum('MasteryTier', ['establishing', 'familiar', 'solid', 'mastery']);
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
    emailOptIn: emailOptInEnum('email_opt_in').notNull().default('not_asked'),
    emailVerified: boolean('email_verified').notNull().default(false),
    pendingEmail: text('pending_email'),
    reminderPromptDismissedAt: timestamp('reminder_prompt_dismissed_at', { withTimezone: true }),
    areaTopUpPromptDismissedAt: timestamp('area_top_up_prompt_dismissed_at', { withTimezone: true }),
    lastActivityBellOpenedAt: timestamp('last_activity_bell_opened_at', { withTimezone: true }),
    knowledgeCardShareToken: text('knowledge_card_share_token'),
    knowledgeCardShareExpiresAt: timestamp('knowledge_card_share_expires_at', { withTimezone: true }),
    slug: text('slug'),
    handle: text('handle'),
    handleLastChangedAt: timestamp('handle_last_changed_at', { withTimezone: true }),
    inviteToken: text('invite_token'),
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
    userId: text('user_id').notNull().references(() => users.id),
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
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id, { onDelete: 'set null' }),
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
    questionId: text('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
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
    userId: text('user_id').notNull().references(() => users.id),
    questionId: text('question_id').notNull().references(() => questions.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedFromContextType: text('added_from_context_type').$type<'feed' | 'joshing_game' | 'manual'>(),
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
    userId: text('user_id').notNull().references(() => users.id),
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
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('PLAYER_MASTERY_user_id_canonical_subcategory_key').on(table.userId, table.canonicalSubcategory),
    index('PLAYER_MASTERY_user_id_idx').on(table.userId),
    index('PLAYER_MASTERY_canonical_subcategory_idx').on(table.canonicalSubcategory),
  ],
);


export const critiqueUsageDaily = pgTable(
  'CritiqueUsageDaily',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    usageDate: date('usage_date').notNull(),
    critiqueCount: integer('critique_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('CritiqueUsageDaily_user_id_usage_date_key').on(table.userId, table.usageDate),
    index('CritiqueUsageDaily_user_id_usage_date_idx').on(table.userId, table.usageDate),
  ],
);

export const masteryEvents = pgTable(
  'MASTERY_EVENTS',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
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
    senderUserId: text('senderUserId').notNull().references(() => users.id),
    recipientUserId: text('recipientUserId').notNull().references(() => users.id),
    questionId: text('questionId').notNull().references(() => questions.id),
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
    index('QuestionReaction_recipientUserId_repliedAt_idx').on(table.recipientUserId, table.repliedAt),
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
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    userId: text('user_id').notNull().references(() => users.id),
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
    index('GeneratedQuestion_domain_key_difficulty_idx').on(table.domainKey, table.difficultyEstimate),
  ],
);

export const questionFeedback = pgTable(
  'QuestionFeedback',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    questionId: text('question_id').references(() => questions.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id),
    signal: feedbackSignalEnum('signal').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('QuestionFeedback_generated_question_id_key').on(table.generatedQuestionId),
    unique('QuestionFeedback_user_id_question_id_key').on(table.userId, table.questionId),
    unique('QuestionFeedback_user_id_generated_question_id_key').on(table.userId, table.generatedQuestionId),
    index('QuestionFeedback_user_id_idx').on(table.userId),
    index('QuestionFeedback_question_id_idx').on(table.questionId),
  ],
);

export const questionRatings = pgTable(
  'QuestionRating',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => users.id),
    questionId: text('question_id').notNull().references(() => questions.id),
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
    reporterUserId: text('reporter_user_id').notNull().references(() => users.id),
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
    userId: text('user_id').notNull().references(() => users.id),
    queueDate: date('queue_date').notNull(),
    slots: jsonb('slots').notNull(),
    createdAt: createdAt(),
    // Set when the daily reminder email has been sent for this queue (one row
    // per user/day). Claimed atomically before send so the cron's retry-replay
    // can't double-send; null = not yet sent, or released back to null after a
    // send failure so a later run can retry.
    emailReminderSentAt: timestamp('email_reminder_sent_at', { withTimezone: true }),
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
    userId: text('user_id').notNull().references(() => users.id),
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
    userId: text('user_id').notNull().references(() => users.id),
    queueId: text('queue_id').notNull().references(() => dailyQueues.id, { onDelete: 'cascade' }),
    questionId: text('question_id').references(() => questions.id),
    generatedQuestionId: text('generated_question_id').references(() => generatedQuestions.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    skippedAt: timestamp('skipped_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('SkippedDailyQuestion_user_id_idx').on(table.userId),
    index('SkippedDailyQuestion_user_id_question_id_idx').on(table.userId, table.questionId),
    index('SkippedDailyQuestion_user_id_generated_question_id_idx').on(table.userId, table.generatedQuestionId),
    index('SkippedDailyQuestion_queue_id_idx').on(table.queueId),
    // Standalone covering indexes for the question_id / generated_question_id
    // FKs (0083 / advisor 0001). The composites above lead with user_id, so they
    // can't serve a lookup/FK-check on the question columns alone.
    index('SkippedDailyQuestion_question_id_idx').on(table.questionId),
    index('SkippedDailyQuestion_generated_question_id_idx').on(table.generatedQuestionId),
  ],
);

export const userDomainDifficulties = pgTable(
  'USER_DOMAIN_DIFFICULTY',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
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
    userId: text('user_id').notNull().references(() => users.id),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    scope: domainExclusionScopeEnum('scope').notNull().default('subcategory'),
    excludedAt: timestamp('excluded_at', { withTimezone: true }).notNull().defaultNow(),
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
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    queueId: text('queue_id').notNull().references(() => dailyQueues.id, { onDelete: 'cascade' }),
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
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    section: profileSectionEnum('section').notNull(),
    visibility: text('visibility').$type<'public' | 'friends' | 'private'>().notNull().default('public'),
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
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    canonicalSubcategory: text('canonical_subcategory').notNull(),
    domain: text('domain').notNull(),
    visibility: text('visibility').$type<'public' | 'friends' | 'private'>().notNull().default('public'),
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
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
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

export const friendships = pgTable(
  'Friendship',
  {
    id: id(),
    userAId: text('userAId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userBId: text('userBId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    requestedByUserId: text('requestedByUserId').notNull().references(() => users.id),
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
    followerId: text('followerId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    followeeId: text('followeeId').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    creatorId: text('creatorId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('JoshingGame_creatorId_idx').on(table.creatorId)],
);

export const feedItems = pgTable(
  'FeedItem',
  {
    id: id(),
    recipientUserId: text('recipientUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('questionId').references(() => questions.id),
    joshingGameId: text('joshingGameId').references(() => joshingGames.id, { onDelete: 'set null' }),
    sourceType: text('sourceType').notNull(),
    sourceUserId: text('sourceUserId').notNull().references(() => users.id),
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
    index('FeedItem_recipientUserId_state_idx').on(table.recipientUserId, table.state, table.sourceEventAt.desc()),
    index('FeedItem_recipientUserId_pinned_idx').on(table.recipientUserId, table.isPinned).where(sql`"isPinned" = TRUE`),
    uniqueIndex('FeedItem_recipientUserId_sourceAnswerId_key').on(table.recipientUserId, table.sourceAnswerId).where(sql`"sourceAnswerId" IS NOT NULL`),
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
    gameId: text('gameId').notNull().references(() => joshingGames.id, { onDelete: 'cascade' }),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    gameId: text('gameId').notNull().references(() => joshingGames.id, { onDelete: 'cascade' }),
    questionId: text('questionId').notNull().references(() => questions.id),
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
    gameId: text('gameId').notNull().references(() => joshingGames.id, { onDelete: 'cascade' }),
    questionId: text('questionId').notNull().references(() => questions.id),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    submittedAnswer: text('submittedAnswer'),
    isCorrect: boolean('isCorrect'),
    isPartial: boolean('isPartial').notNull().default(false),
    answerState: text('answerState'),
    pointsAwarded: doublePrecision('pointsAwarded'),
    answeredAt: timestamp('answeredAt', { withTimezone: true }),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('JoshingGameResponse_gameId_questionId_userId_key').on(table.gameId, table.questionId, table.userId),
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
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    cycleStart: date('cycleStart').notNull(),
    cycleEnd: date('cycleEnd').notNull(),
    firedAt: timestamp('firedAt', { withTimezone: true }).notNull().defaultNow(),
    viewedAt: timestamp('viewedAt', { withTimezone: true }),
    beatsPayload: jsonb('beatsPayload').notNull(),
    shareCardToken: text('shareCardToken'),
  },
  (table) => [
    uniqueIndex('BiweeklyCeremony_shareCardToken_key').on(table.shareCardToken),
    uniqueIndex('BiweeklyCeremony_user_cycle_key').on(table.userId, table.cycleStart, table.cycleEnd),
    index('BiweeklyCeremony_userId_firedAt_idx').on(table.userId, table.firedAt.desc()),
  ],
);

export const activityItems = pgTable(
  'ActivityItem',
  {
    id: id(),
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
    questionId: text('questionId').notNull().references(() => questions.id, { onDelete: 'cascade' }),
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

export const friendInvitations = pgTable(
  'FriendInvitation',
  {
    id: id(),
    inviterUserId: text('inviterUserId').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
    index('FriendInvitation_inviterUserId_inviteePhone_idx').on(table.inviterUserId, table.inviteePhone),
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
    check('AppSettings_categorize_provider_valid', sql`categorize_provider IN ('anthropic', 'openai')`),
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
    check('LlmProviderChangeLog_surface_valid', sql`surface IN ('gen', 'categorize', 'suggest', 'grade')`),
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
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (table) => [
    check('LlmUsageEvent_provider_valid', sql`provider IN ('anthropic', 'openai')`),
    index('LlmUsageEvent_provider_created_at_idx').on(table.provider, table.createdAt),
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
