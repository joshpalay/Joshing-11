import {
  isGenericCanonicalAnswer,
  normalizeCanonicalAnswerLabel,
} from '@/server/answers/canonical-answer';

// Answer-cooldown window (B-DEDUP-ANSWER-COOLDOWN, Tier 1): how far back a
// matching answer suppresses a question whose answer the player already gave.
// Shared by the serve-time gate (queue-orchestrator) and the generation-time
// pre-filter (generate-questions). Env-overridable; default 28 days.
export const ANSWER_COOLDOWN_DAYS = Math.max(0, Number(process.env.ANSWER_COOLDOWN_DAYS ?? 28));

/**
 * Answer-cooldown key (B-DEDUP-ANSWER-COOLDOWN, Tier 1). Two genuinely-different
 * questions can land the SAME answer days apart and read as a repeat — observed
 * 2026-06-24: a user got "which doll does Nathan pick…" (answer "Sarah Brown")
 * and four days later "…what is her name?" (answer "Sarah Brown"). The fact-key,
 * Haiku and embedding gates all treat those as distinct (different angle, only
 * 0.91 cosine vs the 0.88 gate at the time), but the player just sees the same
 * answer twice.
 *
 * This reduces an answer to a comparable head phrase: drop the explanatory tail
 * (dash clauses and parentheticals — "Sarah Brown — because…" / "A rat
 * (Scabbers)"), lowercase, strip a leading article. Returns '' for blank/generic
 * answers, which the gate treats as "never blocks" (no false matches on filler).
 *
 * Deliberately NOT a semantic match — it is the cheap, deterministic companion
 * to the embedding gate, catching exact-answer repeats the embedding gate's 0.88
 * threshold lets through. Same-subject/different-answer repeats (the Pettigrew
 * case) are Tier 2's job, not this.
 */
export function answerCooldownKey(answer: string | null | undefined): string {
  if (!answer) return '';
  // Cut at the first dash clause (em/en/spaced-hyphen) or parenthetical, keeping
  // the head phrase that actually answers the question.
  const head = normalizeCanonicalAnswerLabel(answer).split(/\s*[—–]\s*| - | \(/)[0];
  const core = head
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (core.length < 2) return '';
  if (isGenericCanonicalAnswer(core)) return '';
  return core;
}

export type AnswerCooldownGate = {
  /** True if this answer was answered within the cooldown window or already used in this build. Read-only. */
  blocks: (answer: string | null | undefined) => boolean;
  /** Record an answer as used in this build (call only on final admission). */
  record: (answer: string | null | undefined) => void;
};

/**
 * Build a per-queue answer-cooldown gate. `recentKeys` is the set of cooldown
 * keys the user has answered within the window (see getRecentAnsweredAnswerKeys).
 * The gate also tracks keys admitted in THIS build so two same-answer questions
 * can't share one queue. `blocks` is read-only; `record` is separate so a pick
 * deflected by a LATER gate (diversity) doesn't poison the within-build set.
 */
export function makeAnswerCooldownGate(recentKeys: ReadonlySet<string>): AnswerCooldownGate {
  const usedThisBuild = new Set<string>();
  return {
    blocks(answer) {
      const key = answerCooldownKey(answer);
      if (!key) return false;
      return recentKeys.has(key) || usedThisBuild.has(key);
    },
    record(answer) {
      const key = answerCooldownKey(answer);
      if (key) usedThisBuild.add(key);
    },
  };
}
