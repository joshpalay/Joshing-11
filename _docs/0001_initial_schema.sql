-- =====================================================================
-- JOSHING v11.0 — INITIAL SCHEMA
-- =====================================================================
-- Single migration covering all tables for v11.0 launch.
-- Postgres 14+. Uses gen_random_uuid() (built-in from PG13).
-- =====================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- for question text search

-- =====================================================================
-- ENUMS
-- =====================================================================

CREATE TYPE user_tier AS ENUM ('free', 'plus');

CREATE TYPE difficulty_level AS ENUM (
  'normal',
  'moderate',
  'challenging',
  'ridiculous'
);

CREATE TYPE difficulty_setting AS ENUM (
  'normal',
  'moderate',
  'challenging',
  'ridiculous',
  'adaptive'
);

CREATE TYPE response_source AS ENUM (
  'daily_five',
  'feed',
  'direct_sent',
  'personal_round',
  'catch_up'
);

CREATE TYPE feed_item_source_type AS ENUM (
  'direct_sent',
  'authored_shared',
  'thumbs_upped'
);

CREATE TYPE feed_item_state AS ENUM (
  'active',
  'answered',
  'skipped',
  'dismissed',
  'rolled_off'
);

CREATE TYPE friendship_origin AS ENUM (
  'invitation',
  'in_app_request'
);

CREATE TYPE domain_selection_mode AS ENUM (
  'random',
  'custom'
);

-- =====================================================================
-- USERS
-- =====================================================================

CREATE TABLE users (
  user_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number         TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  tier                 user_tier NOT NULL DEFAULT 'free',

  -- Notification prefs (JSON for flexibility; keys defined per §8.11)
  notification_prefs   JSONB NOT NULL DEFAULT '{
    "daily_five": true,
    "friend_sent_question": true,
    "friend_thumbs_up": false,
    "friend_reaction": false,
    "friend_invitation_accepted": true,
    "friend_request_received": true,
    "biweekly_ceremony": true
  }'::jsonb,

  -- Quiet hours (player-local time)
  quiet_hours_start    TIME NOT NULL DEFAULT '21:00',
  quiet_hours_end      TIME NOT NULL DEFAULT '08:00',
  timezone             TEXT NOT NULL DEFAULT 'America/New_York',

  -- Adaptive difficulty current level (1.0 = Normal, 4.0 = Ridiculous)
  adaptive_level       NUMERIC(3,1) NOT NULL DEFAULT 1.0,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

CREATE INDEX idx_users_phone_active ON users(phone_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_slug_active ON users(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_created_at ON users(created_at);  -- for ceremony anchor batching

-- E.164 format constraint (basic — production may want stricter validation)
ALTER TABLE users ADD CONSTRAINT chk_phone_e164
  CHECK (phone_number ~ '^\+1[0-9]{10}$');

-- Adaptive level bounds
ALTER TABLE users ADD CONSTRAINT chk_adaptive_level
  CHECK (adaptive_level >= 1.0 AND adaptive_level <= 4.0);

-- =====================================================================
-- DOMAINS (global registry of hyper-specific domains)
-- =====================================================================

CREATE TABLE domains (
  domain_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name       TEXT NOT NULL UNIQUE,        -- "Late Tchaikovsky"
  broad_category       TEXT NOT NULL,                -- "Classical Music"
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id   UUID REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX idx_domains_broad_category ON domains(broad_category);
CREATE INDEX idx_domains_canonical_name_trgm ON domains USING gin (canonical_name gin_trgm_ops);

-- =====================================================================
-- DECLARED_INTERESTS (per §8.4.2 — max 5 active per user)
-- =====================================================================

CREATE TABLE declared_interests (
  interest_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  domain_id            UUID NOT NULL REFERENCES domains(domain_id) ON DELETE RESTRICT,
  declared_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active            BOOLEAN NOT NULL DEFAULT true,
  deactivated_at       TIMESTAMPTZ
);

CREATE INDEX idx_declared_interests_user_active
  ON declared_interests(user_id) WHERE is_active = true;

-- A user can only have a given domain declared once at a time
CREATE UNIQUE INDEX uq_declared_interests_user_domain_active
  ON declared_interests(user_id, domain_id) WHERE is_active = true;

-- Enforce max 5 active declared interests per user via a trigger
CREATE OR REPLACE FUNCTION enforce_max_5_declared_interests()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    IF (SELECT COUNT(*) FROM declared_interests
        WHERE user_id = NEW.user_id AND is_active = true
        AND interest_id != NEW.interest_id) >= 5 THEN
      RAISE EXCEPTION 'User % already has 5 active declared interests', NEW.user_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_max_5_declared_interests
  BEFORE INSERT OR UPDATE ON declared_interests
  FOR EACH ROW EXECUTE FUNCTION enforce_max_5_declared_interests();

-- =====================================================================
-- QUESTIONS
-- =====================================================================

CREATE TABLE questions (
  question_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text                     TEXT NOT NULL,
  correct_answer           TEXT NOT NULL,
  acceptable_variants      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of strings
  domain_id                UUID NOT NULL REFERENCES domains(domain_id) ON DELETE RESTRICT,
  difficulty               difficulty_level NOT NULL,
  creator_note             TEXT,
  brief_explainer          TEXT,

  -- Authorship
  original_author_id       UUID REFERENCES users(user_id) ON DELETE SET NULL,
  is_llm_generated         BOOLEAN NOT NULL DEFAULT false,

  -- Distribution
  is_shared_to_friends     BOOLEAN NOT NULL DEFAULT false,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_domain ON questions(domain_id);
CREATE INDEX idx_questions_author ON questions(original_author_id) WHERE original_author_id IS NOT NULL;
CREATE INDEX idx_questions_llm ON questions(is_llm_generated) WHERE is_llm_generated = true;
CREATE INDEX idx_questions_shared ON questions(is_shared_to_friends) WHERE is_shared_to_friends = true;
CREATE INDEX idx_questions_text_trgm ON questions USING gin (text gin_trgm_ops);

ALTER TABLE questions ADD CONSTRAINT chk_text_length CHECK (char_length(text) <= 500);
ALTER TABLE questions ADD CONSTRAINT chk_explainer_length CHECK (brief_explainer IS NULL OR char_length(brief_explainer) <= 280);

-- LLM-generated questions cannot have a human author
ALTER TABLE questions ADD CONSTRAINT chk_llm_no_author
  CHECK (NOT (is_llm_generated = true AND original_author_id IS NOT NULL));

-- =====================================================================
-- QUESTION_RESPONSES (the master ledger of all play)
-- =====================================================================

CREATE TABLE question_responses (
  response_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id          UUID NOT NULL REFERENCES questions(question_id) ON DELETE RESTRICT,
  user_id              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

  submitted_answer     TEXT NOT NULL,
  is_correct           BOOLEAN NOT NULL,
  is_partial           BOOLEAN NOT NULL DEFAULT false,
  points_awarded       NUMERIC(6,2) NOT NULL DEFAULT 0,

  source               response_source NOT NULL,
  source_friend_id     UUID REFERENCES users(user_id) ON DELETE SET NULL,

  -- Difficulty actually served at time of answer (for adaptive tracking)
  served_difficulty    difficulty_level NOT NULL,

  thumbs_upped         BOOLEAN NOT NULL DEFAULT false,
  reaction_text        TEXT,

  answered_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_responses_user_answered ON question_responses(user_id, answered_at DESC);
CREATE INDEX idx_responses_question ON question_responses(question_id);
CREATE INDEX idx_responses_source_friend ON question_responses(source_friend_id) WHERE source_friend_id IS NOT NULL;
CREATE INDEX idx_responses_user_correct ON question_responses(user_id, is_correct);

-- A user can answer a given question only once successfully
-- (allow multiple wrong answers, but enforce one correct)
CREATE UNIQUE INDEX uq_responses_user_question_correct
  ON question_responses(user_id, question_id) WHERE is_correct = true;

-- partial implies correct = false in our model (per §8.1.9)
ALTER TABLE question_responses ADD CONSTRAINT chk_partial_not_correct
  CHECK (NOT (is_partial = true AND is_correct = true));

-- direct_sent and feed sources require a source_friend_id
ALTER TABLE question_responses ADD CONSTRAINT chk_friend_source_has_friend
  CHECK (
    (source IN ('feed', 'direct_sent') AND source_friend_id IS NOT NULL)
    OR (source NOT IN ('feed', 'direct_sent'))
  );

-- =====================================================================
-- FRIENDSHIPS (symmetric, single row per pair)
-- =====================================================================

CREATE TABLE friendships (
  friendship_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_b_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  formed_via           friendship_origin NOT NULL,
  formed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at           TIMESTAMPTZ,
  removed_by_user_id   UUID REFERENCES users(user_id) ON DELETE SET NULL
);

-- Always store with user_a_id < user_b_id for canonical ordering
ALTER TABLE friendships ADD CONSTRAINT chk_canonical_order
  CHECK (user_a_id < user_b_id);

CREATE UNIQUE INDEX uq_friendships_pair ON friendships(user_a_id, user_b_id);
CREATE INDEX idx_friendships_user_a_active ON friendships(user_a_id) WHERE removed_at IS NULL;
CREATE INDEX idx_friendships_user_b_active ON friendships(user_b_id) WHERE removed_at IS NULL;

-- Helper view for "is X a friend of Y" queries
CREATE VIEW active_friendships AS
SELECT user_a_id AS user_id, user_b_id AS friend_id, formed_at
  FROM friendships WHERE removed_at IS NULL
UNION ALL
SELECT user_b_id AS user_id, user_a_id AS friend_id, formed_at
  FROM friendships WHERE removed_at IS NULL;

-- =====================================================================
-- INVITATIONS
-- =====================================================================

CREATE TABLE invitations (
  invitation_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  invitee_phone            TEXT NOT NULL,
  invitee_user_id          UUID REFERENCES users(user_id) ON DELETE SET NULL,
  pre_seeded_interests     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of domain_ids
  personal_message         TEXT,
  invite_token             TEXT NOT NULL UNIQUE,  -- the link token
  sent_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at              TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX idx_invitations_inviter ON invitations(inviter_user_id);
CREATE INDEX idx_invitations_phone_pending ON invitations(invitee_phone) WHERE accepted_at IS NULL;
CREATE INDEX idx_invitations_token ON invitations(invite_token);

ALTER TABLE invitations ADD CONSTRAINT chk_invitee_phone_e164
  CHECK (invitee_phone ~ '^\+1[0-9]{10}$');

ALTER TABLE invitations ADD CONSTRAINT chk_max_3_preseeded
  CHECK (jsonb_array_length(pre_seeded_interests) <= 3);

-- =====================================================================
-- IN-APP FRIEND REQUESTS (Path 2 of friendship formation)
-- =====================================================================

CREATE TABLE friend_requests (
  request_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sent_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at         TIMESTAMPTZ,
  was_accepted         BOOLEAN
);

CREATE INDEX idx_friend_requests_recipient_pending
  ON friend_requests(recipient_user_id) WHERE responded_at IS NULL;

CREATE UNIQUE INDEX uq_friend_requests_pending
  ON friend_requests(requester_user_id, recipient_user_id)
  WHERE responded_at IS NULL;

ALTER TABLE friend_requests ADD CONSTRAINT chk_no_self_request
  CHECK (requester_user_id != recipient_user_id);

-- =====================================================================
-- FEED_ITEMS
-- =====================================================================

CREATE TABLE feed_items (
  feed_item_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id          UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  source_type          feed_item_source_type NOT NULL,
  source_user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source_event_at      TIMESTAMPTZ NOT NULL,
  state                feed_item_state NOT NULL DEFAULT 'active',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  state_changed_at     TIMESTAMPTZ
);

-- The big query: get a user's active feed
CREATE INDEX idx_feed_items_recipient_active
  ON feed_items(recipient_user_id, source_type, source_event_at DESC)
  WHERE state = 'active';

-- For collapse-on-display ("Greg + 2 others thumbed up")
CREATE INDEX idx_feed_items_recipient_question_type
  ON feed_items(recipient_user_id, question_id, source_type);

-- A user shouldn't get the same question twice from the same source friend & type
CREATE UNIQUE INDEX uq_feed_items_dedupe
  ON feed_items(recipient_user_id, question_id, source_user_id, source_type);

-- A user can't have a feed item where they are also the source
ALTER TABLE feed_items ADD CONSTRAINT chk_no_self_feed
  CHECK (recipient_user_id != source_user_id);

-- =====================================================================
-- SENT_QUESTIONS (direct sends, separate from feed_items for rate-limit & archive)
-- =====================================================================

CREATE TABLE sent_questions (
  sent_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id          UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  sent_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sent_questions_sender ON sent_questions(sender_user_id, sent_at DESC);
CREATE INDEX idx_sent_questions_recipient ON sent_questions(recipient_user_id, sent_at DESC);

-- Used for the 5/day/recipient rate limit
CREATE INDEX idx_sent_questions_rate_limit
  ON sent_questions(sender_user_id, recipient_user_id, sent_at);

ALTER TABLE sent_questions ADD CONSTRAINT chk_no_self_send
  CHECK (sender_user_id != recipient_user_id);

-- =====================================================================
-- USER_QUESTION_BANK (a user's saved questions)
-- =====================================================================

CREATE TABLE user_question_bank (
  bank_entry_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  question_id              UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  imported_from_user_id    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  added_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_bank_user_question ON user_question_bank(user_id, question_id);
CREATE INDEX idx_bank_user_added ON user_question_bank(user_id, added_at DESC);

-- =====================================================================
-- DAILY_FIVE_SESSIONS
-- =====================================================================

CREATE TABLE daily_five_sessions (
  session_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  session_date             DATE NOT NULL,
  difficulty_setting       difficulty_setting NOT NULL,
  -- For Adaptive: what numeric level was actually used
  served_adaptive_level    NUMERIC(3,1),
  domain_selection_mode    domain_selection_mode NOT NULL,
  selected_domain_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of domain_ids when custom
  question_ids             JSONB NOT NULL,  -- ordered array of 5 question_ids
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_daily_five_user_date
  ON daily_five_sessions(user_id, session_date);

CREATE INDEX idx_daily_five_user_recent
  ON daily_five_sessions(user_id, session_date DESC);

-- =====================================================================
-- CEREMONIES (biweekly reflection)
-- =====================================================================

CREATE TABLE ceremonies (
  ceremony_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  cycle_start          DATE NOT NULL,
  cycle_end            DATE NOT NULL,
  fired_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  viewed_at            TIMESTAMPTZ,
  beats_payload        JSONB NOT NULL,  -- snapshotted 5 beats per §8.8.4
  share_card_id        UUID
);

CREATE UNIQUE INDEX uq_ceremonies_user_cycle
  ON ceremonies(user_id, cycle_start);

CREATE INDEX idx_ceremonies_user_recent
  ON ceremonies(user_id, fired_at DESC);

-- =====================================================================
-- SHARE_CARDS (generated from biweekly ceremonies & ad-hoc)
-- =====================================================================

CREATE TABLE share_cards (
  share_card_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ceremony_id          UUID REFERENCES ceremonies(ceremony_id) ON DELETE SET NULL,
  -- Snapshot of card content (text + visual params)
  card_payload         JSONB NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_share_cards_user ON share_cards(user_id, created_at DESC);

-- Add the share_card FK on ceremonies now that share_cards exists
ALTER TABLE ceremonies
  ADD CONSTRAINT fk_ceremonies_share_card
  FOREIGN KEY (share_card_id) REFERENCES share_cards(share_card_id) ON DELETE SET NULL;

-- =====================================================================
-- AUTH (SMS OTP)
-- =====================================================================

CREATE TABLE auth_otps (
  otp_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number         TEXT NOT NULL,
  code_hash            TEXT NOT NULL,  -- never store the code in plaintext
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes'),
  consumed_at          TIMESTAMPTZ,
  attempt_count        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_auth_otps_phone_recent ON auth_otps(phone_number, created_at DESC);

-- For rate limiting (max 3 OTPs per phone per hour)
CREATE INDEX idx_auth_otps_phone_window
  ON auth_otps(phone_number, created_at)
  WHERE consumed_at IS NULL;

-- =====================================================================
-- SMS LOG (for delivery tracking + debugging)
-- =====================================================================

CREATE TABLE sms_log (
  sms_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(user_id) ON DELETE SET NULL,
  phone_number         TEXT NOT NULL,
  message_type         TEXT NOT NULL,  -- 'otp', 'daily_five', 'friend_sent', etc.
  body                 TEXT NOT NULL,
  twilio_sid           TEXT,
  status               TEXT,  -- 'queued', 'sent', 'delivered', 'failed'
  sent_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  error_message        TEXT
);

CREATE INDEX idx_sms_log_user_recent ON sms_log(user_id, sent_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_sms_log_phone_recent ON sms_log(phone_number, sent_at DESC);
CREATE INDEX idx_sms_log_type_recent ON sms_log(message_type, sent_at DESC);

-- =====================================================================
-- LLM_CALL_LOG (for cost tracking + debugging)
-- =====================================================================

CREATE TABLE llm_call_log (
  call_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES users(user_id) ON DELETE SET NULL,
  call_type            TEXT NOT NULL,  -- 'daily_five_gen', 'grade', 'categorize', etc.
  model                TEXT NOT NULL,
  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,
  total_tokens         INTEGER,
  latency_ms           INTEGER,
  was_successful       BOOLEAN NOT NULL,
  error_message        TEXT,
  called_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_llm_log_user_recent ON llm_call_log(user_id, called_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX idx_llm_log_type_recent ON llm_call_log(call_type, called_at DESC);

-- =====================================================================
-- ALIGNMENT_CACHE (per-pair intellectual alignment, refreshed periodically)
-- =====================================================================

CREATE TABLE alignment_cache (
  user_a_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_b_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  alignment_score      NUMERIC(5,2) NOT NULL,  -- 0.00 to 100.00
  shared_domain_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a_id, user_b_id)
);

ALTER TABLE alignment_cache ADD CONSTRAINT chk_alignment_canonical_order
  CHECK (user_a_id < user_b_id);

CREATE INDEX idx_alignment_user_a ON alignment_cache(user_a_id, alignment_score DESC);
CREATE INDEX idx_alignment_user_b ON alignment_cache(user_b_id, alignment_score DESC);

-- =====================================================================
-- updated_at TRIGGERS
-- =====================================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER trg_questions_updated_at
  BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
