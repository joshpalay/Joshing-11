CREATE TYPE "public"."Category" AS ENUM('music', 'literature', 'history', 'film_tv', 'sport', 'science', 'philosophy', 'pop_culture', 'language', 'other');--> statement-breakpoint
CREATE TYPE "public"."QuestionVisibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TYPE "public"."PublicStatus" AS ENUM('not_scored', 'eligible_pending', 'opted_out', 'migrated', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."AnswerSource" AS ENUM('llm_suggested', 'creator_written', 'llm_edited');--> statement-breakpoint
CREATE TYPE "public"."QuestionStatus" AS ENUM('verified', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."QuestionType" AS ENUM('factual', 'personal', 'ambiguous', 'factual_uncertain');--> statement-breakpoint
CREATE TYPE "public"."GradeDisputeStatus" AS ENUM('pending', 'reviewed', 'alternative_added', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."DifficultyEstimate" AS ENUM('accessible', 'moderate', 'specialist');--> statement-breakpoint
CREATE TYPE "public"."ReactionCanned" AS ENUM('always_knew', 'got_me', 'of_course_you', 'never_heard', 'need_to_talk', 'didnt_know_tell_me', 'need_story', 'adding_to_list', 'knew_i_wouldnt');--> statement-breakpoint
CREATE TYPE "public"."CreatorResponseCanned" AS ENUM('knew_youd_get_it', 'surprised_you_knew', 'just_for_you', 'story_here');--> statement-breakpoint
CREATE TYPE "public"."SmsMessageType" AS ENUM('otp', 'daily_questions', 'daily_questions_batched', 'invitation', 'star_notification', 'correct_answer_notification', 'question_reaction', 'creator_reaction_response', 'game_complete', 'game_summary_ready', 'expiry_reminder', 'incognito_round_invitation', 'anniversary_milestone', 'creator_note_prompt');--> statement-breakpoint
CREATE TYPE "public"."AnswerState" AS ENUM('first_correct', 'first_correct_after_wrong', 'repeat_correct', 'incorrect');--> statement-breakpoint
CREATE TYPE "public"."SmsOptIn" AS ENUM('opted_in', 'opted_out', 'not_asked');--> statement-breakpoint
CREATE TYPE "public"."ThemePreference" AS ENUM('quiet_atelier', 'sunday_margins', 'parlor_index');--> statement-breakpoint
CREATE TYPE "public"."SubscriptionPlan" AS ENUM('free', 'plus_monthly', 'plus_yearly');--> statement-breakpoint
CREATE TYPE "public"."PortraitVisibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."MasteryTier" AS ENUM('establishing', 'familiar', 'solid', 'mastery');--> statement-breakpoint
CREATE TYPE "public"."MasterySourceType" AS ENUM('live_correct', 'authored', 'author_credit', 'catchup_correct');--> statement-breakpoint
CREATE TYPE "public"."FeedbackSignal" AS ENUM('thumbs_up', 'thumbs_down');--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"phone_number" text NOT NULL,
	"email" text,
	"display_name" text,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"is_subscriber" boolean DEFAULT false NOT NULL,
	"preferred_theme" "ThemePreference" DEFAULT 'quiet_atelier' NOT NULL,
	"subscription_plan" "SubscriptionPlan" DEFAULT 'free' NOT NULL,
	"sms_opt_in" "SmsOptIn" DEFAULT 'not_asked' NOT NULL,
	"sms_reminder_time" integer,
	"portrait_visibility" "PortraitVisibility" DEFAULT 'public' NOT NULL,
	"knowledge_card_share_token" text,
	"knowledge_card_share_expires_at" timestamp with time zone,
	"slug" text,
	"authorProfilePublic" boolean DEFAULT true NOT NULL,
	"onboardingComplete" boolean DEFAULT false NOT NULL,
	"adaptiveLevel" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserSession" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OtpCode" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"phone_number" text NOT NULL,
	"code" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Question" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"creator_id" text NOT NULL,
	"source_question_id" text,
	"source_creator_id" text,
	"question_text" text NOT NULL,
	"breadcrumb_context" text DEFAULT '' NOT NULL,
	"answer_text" text NOT NULL,
	"factual_explanation" text,
	"accepted_alternatives" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"answer_source" "AnswerSource",
	"question_type" "QuestionType" DEFAULT 'factual' NOT NULL,
	"minimum_required" integer,
	"category" "Category" DEFAULT 'other' NOT NULL,
	"broad_category" text,
	"subcategory" text,
	"canonical_subcategory" text,
	"category_overridden" boolean DEFAULT false NOT NULL,
	"creator_note" text,
	"difficulty_estimate" "DifficultyEstimate",
	"llm_difficulty" "DifficultyEstimate",
	"calibrated_difficulty" "DifficultyEstimate",
	"correct_rate" double precision,
	"explainer_brief" text,
	"explainer_full" text,
	"explainer_brief_correct" text,
	"explainer_full_correct" text,
	"explainer_brief_wrong" text,
	"explainer_full_wrong" text,
	"explainer_brief_expired" text,
	"explainer_full_expired" text,
	"short_label" text,
	"status" "QuestionStatus" DEFAULT 'verified' NOT NULL,
	"visibility" "QuestionVisibility" DEFAULT 'public' NOT NULL,
	"public_status" "PublicStatus" DEFAULT 'not_scored' NOT NULL,
	"public_eligibility_score" double precision,
	"public_eligibility_reason" text,
	"sharedToFriendsFeed" boolean DEFAULT false NOT NULL,
	"asked_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "QuestionAudienceTag" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"question_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserQuestionBank" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UserQuestionBank_user_id_question_id_key" UNIQUE("user_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "PLAYER_MASTERY" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"canonical_subcategory" text NOT NULL,
	"broad_category" text,
	"total_points" double precision DEFAULT 0 NOT NULL,
	"tier" "MasteryTier" DEFAULT 'establishing' NOT NULL,
	"tier_reached_at" timestamp with time zone,
	"season_points_start" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PLAYER_MASTERY_user_id_canonical_subcategory_key" UNIQUE("user_id","canonical_subcategory")
);
--> statement-breakpoint
CREATE TABLE "MASTERY_EVENTS" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"canonical_subcategory" text NOT NULL,
	"source_type" "MasterySourceType" NOT NULL,
	"question_id" text,
	"answered_by_user_id" text,
	"answer_id" text,
	"base_points" integer DEFAULT 0 NOT NULL,
	"weight" double precision DEFAULT 0 NOT NULL,
	"awarded_points" double precision DEFAULT 0 NOT NULL,
	"answer_state" "AnswerState",
	"session_context" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "MASTERY_EVENTS_source_type_question_id_answered_by_user_id_key" UNIQUE("source_type","question_id","answered_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "QuestionReaction" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"answerer_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"question_id" text NOT NULL,
	"game_id" text NOT NULL,
	"answer_id" text NOT NULL,
	"canned_response" "ReactionCanned",
	"note" text,
	"creator_response" "CreatorResponseCanned",
	"creator_responded_at" timestamp with time zone,
	"parent_reaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "GradeDispute" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"answer_id" text NOT NULL,
	"question_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"submitted_answer" text NOT NULL,
	"canonical_answer" text NOT NULL,
	"status" "GradeDisputeStatus" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "SmsLog" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text,
	"phone_number" text,
	"message_type" "SmsMessageType" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "GeneratedQuestion" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"canonical_subcategory" text NOT NULL,
	"broad_category" text NOT NULL,
	"question_text" text NOT NULL,
	"answer" text NOT NULL,
	"explainer" text NOT NULL,
	"difficulty_estimate" text NOT NULL,
	"base_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_in_queue" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "QuestionFeedback" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text,
	"generated_question_id" text,
	"signal" "FeedbackSignal" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "QuestionFeedback_user_id_question_id_key" UNIQUE("user_id","question_id"),
	CONSTRAINT "QuestionFeedback_user_id_generated_question_id_key" UNIQUE("user_id","generated_question_id")
);
--> statement-breakpoint
CREATE TABLE "DailyQueue" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"queue_date" date NOT NULL,
	"slots" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "DailyQueue_user_id_queue_date_key" UNIQUE("user_id","queue_date")
);
--> statement-breakpoint
CREATE TABLE "DailyPreference" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"friend_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"include_community" boolean DEFAULT false NOT NULL,
	"selected_domains" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"difficulty_preference" text DEFAULT 'normal' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SkippedDailyQuestion" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"queue_id" text NOT NULL,
	"question_id" text,
	"generated_question_id" text,
	"canonical_subcategory" text NOT NULL,
	"skipped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "USER_DOMAIN_DIFFICULTY" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"canonical_subcategory" text NOT NULL,
	"served_difficulty" "DifficultyEstimate" NOT NULL,
	"consecutive_correct" integer DEFAULT 0 NOT NULL,
	"consecutive_incorrect" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "USER_DOMAIN_DIFFICULTY_user_id_canonical_subcategory_key" UNIQUE("user_id","canonical_subcategory")
);
--> statement-breakpoint
CREATE TABLE "USER_DOMAIN_EXCLUSIONS" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"canonical_subcategory" text NOT NULL,
	"excluded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "USER_DOMAIN_EXCLUSIONS_user_id_canonical_subcategory_key" UNIQUE("user_id","canonical_subcategory")
);
--> statement-breakpoint
CREATE TABLE "PROFILE_DOMAIN_VISIBILITY" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"canonical_subcategory" text NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PROFILE_DOMAIN_VISIBILITY_user_id_canonical_subcategory_key" UNIQUE("user_id","canonical_subcategory")
);
--> statement-breakpoint
CREATE TABLE "DeclaredInterest" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"userId" text NOT NULL,
	"domain" text NOT NULL,
	"broadCategory" text,
	"declaredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	CONSTRAINT "DeclaredInterest_userId_domain_key" UNIQUE("userId","domain")
);
--> statement-breakpoint
CREATE TABLE "Friendship" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"userAId" text NOT NULL,
	"userBId" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requestedByUserId" text NOT NULL,
	"formedVia" text NOT NULL,
	"formedAt" timestamp with time zone,
	"removedAt" timestamp with time zone,
	"removedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Friendship_userAId_userBId_key" UNIQUE("userAId","userBId")
);
--> statement-breakpoint
CREATE TABLE "JoshingGame" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"title" text NOT NULL,
	"creatorId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FeedItem" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"recipientUserId" text NOT NULL,
	"questionId" text,
	"joshingGameId" text,
	"sourceType" text NOT NULL,
	"sourceUserId" text NOT NULL,
	"sourceEventAt" timestamp with time zone DEFAULT now() NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"isPinned" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "JoshingGameRecipient" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"gameId" text NOT NULL,
	"userId" text NOT NULL,
	"sentAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "JoshingGameRecipient_gameId_userId_key" UNIQUE("gameId","userId")
);
--> statement-breakpoint
CREATE TABLE "JoshingGameQuestion" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"gameId" text NOT NULL,
	"questionId" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "JoshingGameQuestion_gameId_position_key" UNIQUE("gameId","position"),
	CONSTRAINT "JoshingGameQuestion_gameId_questionId_key" UNIQUE("gameId","questionId")
);
--> statement-breakpoint
CREATE TABLE "JoshingGameResponse" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"gameId" text NOT NULL,
	"questionId" text NOT NULL,
	"userId" text NOT NULL,
	"submittedAnswer" text,
	"isCorrect" boolean,
	"isPartial" boolean DEFAULT false NOT NULL,
	"answerState" text,
	"pointsAwarded" double precision,
	"answeredAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "JoshingGameResponse_gameId_questionId_userId_key" UNIQUE("gameId","questionId","userId")
);
--> statement-breakpoint
CREATE TABLE "BiweeklyCeremony" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"userId" text NOT NULL,
	"cycleStart" date NOT NULL,
	"cycleEnd" date NOT NULL,
	"firedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"viewedAt" timestamp with time zone,
	"beatsPayload" jsonb NOT NULL,
	"shareCardToken" text
);
--> statement-breakpoint
CREATE TABLE "ActivityItem" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"actorUserId" text,
	"referenceId" text,
	"referenceType" text,
	"read" boolean DEFAULT false NOT NULL,
	"deletedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FriendInvitation" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"inviterUserId" text NOT NULL,
	"inviteePhone" text NOT NULL,
	"inviteeUserId" text,
	"preSeededInterests" jsonb,
	"personalMessage" text,
	"token" text NOT NULL,
	"sentAt" timestamp with time zone DEFAULT now() NOT NULL,
	"acceptedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Question" ADD CONSTRAINT "Question_creator_id_User_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionAudienceTag" ADD CONSTRAINT "QuestionAudienceTag_question_id_Question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserQuestionBank" ADD CONSTRAINT "UserQuestionBank_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserQuestionBank" ADD CONSTRAINT "UserQuestionBank_question_id_Question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PLAYER_MASTERY" ADD CONSTRAINT "PLAYER_MASTERY_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MASTERY_EVENTS" ADD CONSTRAINT "MASTERY_EVENTS_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "MASTERY_EVENTS" ADD CONSTRAINT "MASTERY_EVENTS_question_id_Question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionReaction" ADD CONSTRAINT "QuestionReaction_answerer_id_User_id_fk" FOREIGN KEY ("answerer_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionReaction" ADD CONSTRAINT "QuestionReaction_creator_id_User_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionReaction" ADD CONSTRAINT "QuestionReaction_question_id_Question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionFeedback" ADD CONSTRAINT "QuestionFeedback_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionFeedback" ADD CONSTRAINT "QuestionFeedback_question_id_Question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "QuestionFeedback" ADD CONSTRAINT "QuestionFeedback_generated_question_id_GeneratedQuestion_id_fk" FOREIGN KEY ("generated_question_id") REFERENCES "public"."GeneratedQuestion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DailyQueue" ADD CONSTRAINT "DailyQueue_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DailyPreference" ADD CONSTRAINT "DailyPreference_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SkippedDailyQuestion" ADD CONSTRAINT "SkippedDailyQuestion_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SkippedDailyQuestion" ADD CONSTRAINT "SkippedDailyQuestion_queue_id_DailyQueue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."DailyQueue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SkippedDailyQuestion" ADD CONSTRAINT "SkippedDailyQuestion_question_id_Question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SkippedDailyQuestion" ADD CONSTRAINT "SkippedDailyQuestion_generated_question_id_GeneratedQuestion_id_fk" FOREIGN KEY ("generated_question_id") REFERENCES "public"."GeneratedQuestion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "USER_DOMAIN_DIFFICULTY" ADD CONSTRAINT "USER_DOMAIN_DIFFICULTY_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "USER_DOMAIN_EXCLUSIONS" ADD CONSTRAINT "USER_DOMAIN_EXCLUSIONS_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PROFILE_DOMAIN_VISIBILITY" ADD CONSTRAINT "PROFILE_DOMAIN_VISIBILITY_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DeclaredInterest" ADD CONSTRAINT "DeclaredInterest_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_User_id_fk" FOREIGN KEY ("userAId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_User_id_fk" FOREIGN KEY ("userBId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_requestedByUserId_User_id_fk" FOREIGN KEY ("requestedByUserId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_removedByUserId_User_id_fk" FOREIGN KEY ("removedByUserId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGame" ADD CONSTRAINT "JoshingGame_creatorId_User_id_fk" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_recipientUserId_User_id_fk" FOREIGN KEY ("recipientUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_joshingGameId_JoshingGame_id_fk" FOREIGN KEY ("joshingGameId") REFERENCES "public"."JoshingGame"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_sourceUserId_User_id_fk" FOREIGN KEY ("sourceUserId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGameRecipient" ADD CONSTRAINT "JoshingGameRecipient_gameId_JoshingGame_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."JoshingGame"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGameRecipient" ADD CONSTRAINT "JoshingGameRecipient_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGameQuestion" ADD CONSTRAINT "JoshingGameQuestion_gameId_JoshingGame_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."JoshingGame"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGameQuestion" ADD CONSTRAINT "JoshingGameQuestion_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGameResponse" ADD CONSTRAINT "JoshingGameResponse_gameId_JoshingGame_id_fk" FOREIGN KEY ("gameId") REFERENCES "public"."JoshingGame"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGameResponse" ADD CONSTRAINT "JoshingGameResponse_questionId_Question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "JoshingGameResponse" ADD CONSTRAINT "JoshingGameResponse_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "BiweeklyCeremony" ADD CONSTRAINT "BiweeklyCeremony_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ActivityItem" ADD CONSTRAINT "ActivityItem_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ActivityItem" ADD CONSTRAINT "ActivityItem_actorUserId_User_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FriendInvitation" ADD CONSTRAINT "FriendInvitation_inviterUserId_User_id_fk" FOREIGN KEY ("inviterUserId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "FriendInvitation" ADD CONSTRAINT "FriendInvitation_inviteeUserId_User_id_fk" FOREIGN KEY ("inviteeUserId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "User_phone_number_key" ON "User" USING btree ("phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "User_knowledge_card_share_token_key" ON "User" USING btree ("knowledge_card_share_token");--> statement-breakpoint
CREATE UNIQUE INDEX "User_slug_key" ON "User" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "User_phone_number_idx" ON "User" USING btree ("phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX "UserSession_token_key" ON "UserSession" USING btree ("token");--> statement-breakpoint
CREATE INDEX "UserSession_token_idx" ON "UserSession" USING btree ("token");--> statement-breakpoint
CREATE INDEX "UserSession_user_id_idx" ON "UserSession" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "OtpCode_phone_number_idx" ON "OtpCode" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "Question_creator_id_idx" ON "Question" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "Question_creator_id_deleted_at_idx" ON "Question" USING btree ("creator_id","deleted_at");--> statement-breakpoint
CREATE INDEX "Question_creator_id_visibility_idx" ON "Question" USING btree ("creator_id","visibility");--> statement-breakpoint
CREATE INDEX "Question_broad_category_idx" ON "Question" USING btree ("broad_category");--> statement-breakpoint
CREATE INDEX "Question_canonical_subcategory_idx" ON "Question" USING btree ("canonical_subcategory");--> statement-breakpoint
CREATE INDEX "Question_source_question_id_idx" ON "Question" USING btree ("source_question_id");--> statement-breakpoint
CREATE INDEX "Question_source_creator_id_idx" ON "Question" USING btree ("source_creator_id");--> statement-breakpoint
CREATE INDEX "QuestionAudienceTag_creator_id_idx" ON "QuestionAudienceTag" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "QuestionAudienceTag_question_id_idx" ON "QuestionAudienceTag" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "UserQuestionBank_user_id_idx" ON "UserQuestionBank" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "UserQuestionBank_question_id_idx" ON "UserQuestionBank" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "PLAYER_MASTERY_user_id_idx" ON "PLAYER_MASTERY" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "PLAYER_MASTERY_canonical_subcategory_idx" ON "PLAYER_MASTERY" USING btree ("canonical_subcategory");--> statement-breakpoint
CREATE UNIQUE INDEX "MASTERY_EVENTS_answer_id_key" ON "MASTERY_EVENTS" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "MASTERY_EVENTS_user_id_idx" ON "MASTERY_EVENTS" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "MASTERY_EVENTS_canonical_subcategory_idx" ON "MASTERY_EVENTS" USING btree ("canonical_subcategory");--> statement-breakpoint
CREATE INDEX "MASTERY_EVENTS_question_id_idx" ON "MASTERY_EVENTS" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "MASTERY_EVENTS_answered_by_user_id_idx" ON "MASTERY_EVENTS" USING btree ("answered_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "QuestionReaction_answer_id_key" ON "QuestionReaction" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "QuestionReaction_answerer_id_idx" ON "QuestionReaction" USING btree ("answerer_id");--> statement-breakpoint
CREATE INDEX "QuestionReaction_creator_id_idx" ON "QuestionReaction" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "QuestionReaction_question_id_idx" ON "QuestionReaction" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "QuestionReaction_game_id_idx" ON "QuestionReaction" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "GradeDispute_answer_id_key" ON "GradeDispute" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "GradeDispute_question_id_idx" ON "GradeDispute" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "GradeDispute_creator_id_idx" ON "GradeDispute" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "GradeDispute_status_idx" ON "GradeDispute" USING btree ("status");--> statement-breakpoint
CREATE INDEX "SmsLog_user_id_idx" ON "SmsLog" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "SmsLog_phone_number_idx" ON "SmsLog" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "SmsLog_message_type_sent_at_idx" ON "SmsLog" USING btree ("message_type","sent_at");--> statement-breakpoint
CREATE INDEX "GeneratedQuestion_user_id_idx" ON "GeneratedQuestion" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "GeneratedQuestion_user_id_used_in_queue_idx" ON "GeneratedQuestion" USING btree ("user_id","used_in_queue");--> statement-breakpoint
CREATE UNIQUE INDEX "QuestionFeedback_generated_question_id_key" ON "QuestionFeedback" USING btree ("generated_question_id");--> statement-breakpoint
CREATE INDEX "QuestionFeedback_user_id_idx" ON "QuestionFeedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "QuestionFeedback_question_id_idx" ON "QuestionFeedback" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "DailyQueue_user_id_idx" ON "DailyQueue" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "DailyPreference_user_id_key" ON "DailyPreference" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "DailyPreference_user_id_idx" ON "DailyPreference" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "SkippedDailyQuestion_user_id_idx" ON "SkippedDailyQuestion" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "SkippedDailyQuestion_user_id_question_id_idx" ON "SkippedDailyQuestion" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "SkippedDailyQuestion_user_id_generated_question_id_idx" ON "SkippedDailyQuestion" USING btree ("user_id","generated_question_id");--> statement-breakpoint
CREATE INDEX "SkippedDailyQuestion_queue_id_idx" ON "SkippedDailyQuestion" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "USER_DOMAIN_DIFFICULTY_user_id_idx" ON "USER_DOMAIN_DIFFICULTY" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "PROFILE_DOMAIN_VISIBILITY_user_id_idx" ON "PROFILE_DOMAIN_VISIBILITY" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "DeclaredInterest_userId_isActive_idx" ON "DeclaredInterest" USING btree ("userId","isActive");--> statement-breakpoint
CREATE INDEX "Friendship_userAId_status_idx" ON "Friendship" USING btree ("userAId","status");--> statement-breakpoint
CREATE INDEX "Friendship_userBId_status_idx" ON "Friendship" USING btree ("userBId","status");--> statement-breakpoint
CREATE INDEX "JoshingGame_creatorId_idx" ON "JoshingGame" USING btree ("creatorId");--> statement-breakpoint
CREATE INDEX "FeedItem_recipientUserId_state_idx" ON "FeedItem" USING btree ("recipientUserId","state","sourceEventAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "FeedItem_recipientUserId_pinned_idx" ON "FeedItem" USING btree ("recipientUserId","isPinned") WHERE "isPinned" = TRUE;--> statement-breakpoint
CREATE INDEX "JoshingGameRecipient_userId_idx" ON "JoshingGameRecipient" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "JoshingGameRecipient_gameId_idx" ON "JoshingGameRecipient" USING btree ("gameId");--> statement-breakpoint
CREATE INDEX "JoshingGameResponse_gameId_userId_idx" ON "JoshingGameResponse" USING btree ("gameId","userId");--> statement-breakpoint
CREATE INDEX "JoshingGameResponse_userId_idx" ON "JoshingGameResponse" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "BiweeklyCeremony_shareCardToken_key" ON "BiweeklyCeremony" USING btree ("shareCardToken");--> statement-breakpoint
CREATE INDEX "BiweeklyCeremony_userId_firedAt_idx" ON "BiweeklyCeremony" USING btree ("userId","firedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ActivityItem_userId_read_idx" ON "ActivityItem" USING btree ("userId","read","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ActivityItem_userId_createdAt_idx" ON "ActivityItem" USING btree ("userId","createdAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "FriendInvitation_token_key" ON "FriendInvitation" USING btree ("token");--> statement-breakpoint
CREATE INDEX "FriendInvitation_token_idx" ON "FriendInvitation" USING btree ("token");--> statement-breakpoint
CREATE INDEX "FriendInvitation_inviterUserId_idx" ON "FriendInvitation" USING btree ("inviterUserId");