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

export const questionVisibilityEnum = pgEnum('QuestionVisibility', ['private', 'public', 'friends']);

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
]);
export const answerSourceEnum = pgEnum('AnswerSource', ['llm_suggested', 'creator_written', 'llm_edited']);
export const questionStatusEnum = pgEnum('QuestionStatus', ['verified', 'unverified']);
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
    // D-1 Stage 3 — gate on new followers. Default approval_required; public is opt-in.
    followPrivacy: followPrivacyEnum('follow_privacy').notNull().default('approval_required'),
    phoneHash: text('phone_hash'),
    lastFriendDiscoveryCheckAt: timestamp('last_friend_discovery_check_at', { withTimezone: true }),
    onboardingComplete: boolean('onboardingComplete').notNull().default(false),
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
    creatorNote: text('creator_note'),
    insideJoke: text('inside_joke'),
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
    // Voyage voyage-3.5-lite embedding (1024-dim) — semantic-dedup backstop.
    // Nullable: populated at insert and by the batched backfill (B3).
    embedding: vector('embedding', { dimensions: 1024 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
    // Voyage voyage-3.5-lite embedding (1024-dim) — semantic-dedup backstop.
    embedding: vector('embedding', { dimensions: 1024 }),
  },
  (table) => [
    index('GeneratedQuestion_user_id_idx').on(table.userId),
    index('GeneratedQuestion_user_id_used_in_queue_idx').on(table.userId, table.usedInQueue),
    index('GeneratedQuestion_user_id_fact_key_idx').on(table.userId, table.factKey),
    // Selection-layer filters (B1): tier/scope filter capability + suppress-aware
    // bank pick. Not gated on any live surface yet (B4 owns enforcement).
    index('GeneratedQuestion_trust_tier_idx').on(table.trustTier),
    index('GeneratedQuestion_is_duplicate_idx').on(table.isDuplicate),
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

export const dailyQueues = pgTable(
  'DailyQueue',
  {
    id: id(),
    userId: text('user_id').notNull().references(() => users.id),
    queueDate: date('queue_date').notNull(),
    slots: jsonb('slots').notNull(),
    createdAt: createdAt(),
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
    sourceResult: text('sourceResult').$type<'correct' | 'incorrect' | null>(),
    sourceEventAt: timestamp('sourceEventAt', { withTimezone: true }).notNull().defaultNow(),
    personalMessage: text('personalMessage'),
    submittedAnswer: text('submittedAnswer'),
    answerResult: text('answerResult').$type<'correct' | 'incorrect'>(),
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
    index('FriendInvitation_inviteePhone_idx').on(table.inviteePhone),
    index('FriendInvitation_inviterUserId_inviteePhone_idx').on(table.inviterUserId, table.inviteePhone),
  ],
);
