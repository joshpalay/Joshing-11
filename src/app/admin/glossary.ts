// One shared vocabulary for the admin tool. Every term of art an admin page
// shows (status enums, flags, jargon chips) should carry one of these
// definitions via <InfoTerm>, so meaning never lives only in a hover tooltip
// (the admin pages are used on phones, where there is no hover).
//
// Naming canon (D-ADMIN-USABILITY-01): the automated fact-checker is called
// the VERIFIER everywhere — never "the machine" or "the LLM" — and raw enum
// values (soft_finite, vet/cron, generated) never render verbatim.

export const GLOSSARY = {
  // ── The verifier ───────────────────────────────────────────────────────────
  verifier:
    'The automated fact-checker. It generates a fresh answer, checks it against sources, and pulls (demotes) questions that fail.',

  // ── Question provenance ────────────────────────────────────────────────────
  canonical_question:
    'A question in the main pool (human- or house-authored, or promoted there).',
  machine_drafted:
    'A question from the generated store — drafted by the machine, not a person.',
  removed_automatically:
    'Blocked by an automated vetting verdict or scheduled sweep, not by a human.',

  // ── Question flags (Library) ───────────────────────────────────────────────
  trust_tier:
    'How far this question has been vetted: unverified → machine verified (passed the verifier) → human validated (a person checked it) → author confirmed.',
  verdict:
    "The verifier's last ruling: ok (passed) · demoted (pulled from circulation) · unverifiable (couldn't settle it) · skipped (not checked).",
  visibility:
    'Who can be served this question: public · friends · private · blocked (removed by moderation).',
  tombstone:
    'The author deleted their account. The question stays, attributed neutrally to the house.',
  perishable:
    'Tied to a point in time — its answer can go stale (e.g. "current champion").',
  nobody_correct:
    'Asked several times and nobody has ever answered it correctly — a possible bad answer key.',
  duplicate: 'Flagged as a near-copy of another question in the pool.',
  soft_deleted:
    'Soft-deleted: hidden from players but kept inspectable under "Show deleted", and restorable.',

  // ── Supply states (Domains → Supply) ───────────────────────────────────────
  supply_ran_dry:
    'Generation went dry far short of a trusted size estimate — a supply problem to investigate, not a finished domain.',
  supply_estimate_too_low:
    'Generation has reached (or beaten) the size estimate and is still producing — the estimate is probably too low; raise it.',
  supply_filling: 'Generation is still producing normally, below the size estimate.',
  supply_likely_complete:
    'Went dry close to its estimate — believed complete ("resting"). Still re-probed occasionally in case new material appears.',
  supply_unsized:
    'No size estimate yet — run Re-estimate (the corpus resolver) or set one by hand to classify it.',
  supply_capped:
    'Generation is switched off for this domain by hand. Existing questions still serve, and it never raises a supply alarm.',
  supply_estimate:
    'How many questions this domain is believed to support, from the corpus resolver — or a manual override, which always wins.',
  supply_confidence: 'How much to trust the size estimate, as reported by the corpus resolver.',
  supply_basis: 'What the corpus resolver grounded the size estimate on.',
  dry_rounds:
    'Consecutive generation rounds that produced nothing new here. Feeds the supply state.',

  // ── Knowledge tree ─────────────────────────────────────────────────────────
  territory:
    'A subject area in the knowledge tree (e.g. "Beethoven"). Questions file under territories; players master them.',
  unfiled:
    'A label with questions but no territory in the tree yet — real content waiting to be filed.',
  pts_to_master:
    'The mastery target for this territory, in points. A player masters it at 75% of this number. Color shows size: green small, gold moderate, red large.',
  pts_available:
    'Points currently earnable here (difficulty-weighted, rolled up through the subtree for parents). Compare against the mastery target.',
  exhausted:
    'Generation has dried up here: the machine keeps repeating itself and few servable facts remain, so supply is frozen below what mastering needs. A human decision is needed — author more, merge it up, or shrink the target.',
  duplicates_rate:
    'The share of generated questions here that came back as duplicates. High = fresh facts are getting hard to find.',
  thin_leaf: 'Too few questions to stand alone — a candidate to move under a broader parent.',
  in_graph: 'This label has an authored territory in the knowledge tree.',
  label_only:
    'A raw label from the question corpus — not in the knowledge tree. Merging or nesting adds it.',

  // ── Review queue ───────────────────────────────────────────────────────────
  player_report: 'A player flagged this question as inappropriate or incorrect.',
  verifier_demotion:
    'The verifier pulled this question out of circulation after a failed fact-check; it waits here for your call.',
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
