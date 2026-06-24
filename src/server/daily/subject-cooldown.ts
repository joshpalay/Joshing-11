import { answerCooldownKey } from '@/server/daily/answer-cooldown';

/**
 * Subject-cooldown (B-DEDUP-SUBJECT-COOLDOWN, Tier 2). Tier 1 catches exact-answer
 * repeats; this catches same-SUBJECT saturation — two genuinely-different facts
 * about one subject landing days apart. Observed 2026-06-24: "what form was Peter
 * Pettigrew hiding in?" (answer: a rat) and, weeks later, "whose name does Harry
 * spot on the Marauder's Map?" (answer: Peter Pettigrew). Different facts,
 * different answers, cosine only ~0.70 — every fact/answer/embedding gate passes
 * them, but they both center on Peter Pettigrew.
 *
 * The trick: the tie is that "Peter Pettigrew" is the ANSWER of one question and
 * the SUBJECT of the other. So we fold BOTH a question's subject and its answer
 * to the same entity-key space (reusing answerCooldownKey — lowercase, strip the
 * dash/parenthetical tail and a leading article) and treat the union as the set
 * of "entities this question touches". A candidate is spaced out if EITHER its
 * subject or its answer matches an entity the player recently touched.
 *
 * Window is shorter than the answer cooldown (subject saturation is a softer
 * signal than an exact repeat). Like the answer gate, deflections fall back to
 * the queue reserves, so this never serves a short queue.
 */
export const SUBJECT_COOLDOWN_DAYS = Math.max(0, Number(process.env.SUBJECT_COOLDOWN_DAYS ?? 14));

/** Fold a subject or answer string to a comparable entity key (shared key space). */
export function entityKey(value: string | null | undefined): string {
  return answerCooldownKey(value);
}

export type SubjectCooldownGate = {
  /** True if the candidate's subject OR answer matches a recently-touched entity, or one used in this build. */
  blocks: (subject: string | null | undefined, answer: string | null | undefined) => boolean;
  /** Record a candidate's entities as used in this build (call only on final admission). */
  record: (subject: string | null | undefined, answer: string | null | undefined) => void;
};

/**
 * Build a per-queue subject-cooldown gate. `recentEntities` is the union of
 * entity keys (subjects ∪ answers) the user touched within the window — see
 * getRecentAnsweredEntities. Also tracks entities admitted in THIS build so two
 * questions about the same subject can't share one queue.
 */
export function makeSubjectCooldownGate(recentEntities: ReadonlySet<string>): SubjectCooldownGate {
  const usedThisBuild = new Set<string>();
  const hit = (key: string) => key !== '' && (recentEntities.has(key) || usedThisBuild.has(key));
  return {
    blocks(subject, answer) {
      return hit(entityKey(subject)) || hit(entityKey(answer));
    },
    record(subject, answer) {
      const s = entityKey(subject);
      const a = entityKey(answer);
      if (s) usedThisBuild.add(s);
      if (a) usedThisBuild.add(a);
    },
  };
}
