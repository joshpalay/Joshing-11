import { beforeAll, describe, expect, it } from 'vitest';

// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string. findAnswerLeaks never touches the DB; a dummy
// URL plus dynamic import (the repo convention) keeps the unit pure.
let findAnswerLeaks: typeof import('@/server/daily/generate-questions').findAnswerLeaks;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ findAnswerLeaks } = await import('@/server/daily/generate-questions'));
});

// Minimal stand-in for the LlmQuestion shape findAnswerLeaks reads. Only
// question_text and answer are inspected; the rest satisfy the type.
function q(question_text: string, answer: string) {
  return {
    canonical_subcategory: 'User Experience Design',
    broad_category: 'Design',
    question_text,
    answer,
    explainer: '',
    difficulty_estimate: 'moderate' as const,
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

describe('findAnswerLeaks', () => {
  it('drops the reported case where the answer appears in the question text', () => {
    const result = findAnswerLeaks([
      q(
        'In UX design, what term describes the mental model a user forms about how a system works?',
        'Mental model',
      ),
    ]);
    expect([...result.toDrop]).toEqual([0]);
    expect(result.reasons[0]).toContain('Mental model');
  });

  it('drops an article-led answer whose bare noun is named in the question (episode-title leak)', () => {
    // Both played in a duo today: the question names the episode title, which is
    // the answer. "A box cutter" / "A fly" never substring-match because of the
    // leading article — the gate must strip it and catch the bare noun.
    const result = findAnswerLeaks([
      q(
        "In the episode 'Box Cutter,' Gus Fring silently kills one of his own men to send Walter and Jesse a message. What does he use as the murder weapon?",
        'A box cutter',
      ),
      q(
        "In the episode 'Fly,' Walt and Jesse spend an entire episode trapped together in the superlab chasing a single intruder. What is it?",
        'A fly',
      ),
    ]);
    expect([...result.toDrop].sort()).toEqual([0, 1]);
  });

  it('drops an answer whose acronym short form is shown in the question (UX-design leak)', () => {
    // Reported 2026-07-15: the answer spells out an acronym the stem already
    // shows in short form. "User Experience (UX) design" collapses to "UX
    // design", which is verbatim in the stem — the whole-answer substring test
    // missed it because the stem never contains the expansion "User Experience".
    const result = findAnswerLeaks([
      q(
        "In UX design, what term refers to the overall process of researching, designing, and improving the quality of a user's interaction with a product or service?",
        'User Experience (UX) design',
      ),
    ]);
    expect([...result.toDrop]).toEqual([0]);
    expect(result.reasons[0]).toContain('User Experience (UX) design');
  });

  it('keeps an acronym-expansion answer whose short form is NOT in the question', () => {
    // Same answer shape, but the stem never shows "UX design", so nothing leaks.
    const result = findAnswerLeaks([
      q(
        'What field studies how people perceive, feel about, and interact with products they use?',
        'User Experience (UX) design',
      ),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps a "what does the acronym stand for" question whose stem must show the acronym', () => {
    // The acronym-collapse must NOT fire on bare-acronym expansions: a define-
    // the-acronym question necessarily shows the acronym, and its answer is the
    // expansion. Dropping these would delete a whole legitimate question type.
    const result = findAnswerLeaks([
      q('What does GPU stand for in computer hardware?', 'Graphics Processing Unit (GPU)'),
      q('In finance, what does the acronym ROI represent?', 'Return on Investment (ROI)'),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps an initials-identification question even when the stem contains the initials', () => {
    // "Franklin D. Roosevelt (FDR)" collapses to the bare acronym "FDR". Even
    // though the stem says "FDR", that is the SUBJECT being identified, not a
    // leak — the answer is the full name. Must be kept.
    const result = findAnswerLeaks([
      q(
        'Which U.S. president is commonly referred to by the initials FDR?',
        'Franklin D. Roosevelt (FDR)',
      ),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps a clean question whose answer is absent from the setup', () => {
    const result = findAnswerLeaks([
      q('What cognitive bias makes recent information feel more important?', 'Recency bias'),
    ]);
    expect(result.toDrop.size).toBe(0);
    expect(result.reasons).toEqual({});
  });

  it('keeps a complete-the-quote question where the answer is the missing word', () => {
    const result = findAnswerLeaks([
      q('Complete the design maxim: "Don\'t make me ___."', 'think'),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('only flags the leaking entries within a mixed batch', () => {
    const result = findAnswerLeaks([
      q('Which Gestalt principle groups nearby elements together?', 'Proximity'),
      q('What is the heuristic about keeping users informed of system status?', 'System status'),
      q('What pricing tactic ends prices in .99?', 'Charm pricing'),
    ]);
    expect([...result.toDrop].sort()).toEqual([1]);
  });

  // --- accepted-form leaks (the "Razumovsky" class) --------------------------

  it('flags an eponym question whose stem names the person the answer is named after', () => {
    // The reported miss. "Andrey Razumovsky (Count Razumovsky)" is not a
    // substring of the stem, so the whole-answer test passed it three times over
    // (2026-06-24 / 08-20 / 08-27, served 08-27). The accepted form "Count
    // Razumovsky" reduces to the one word the stem already quotes.
    const result = findAnswerLeaks([
      q(
        "Beethoven dedicated his three 'Razumovsky' string quartets, Op. 59, to a Russian patron who also happened to be the Russian ambassador to Vienna. What was that patron's name?",
        'Andrey Razumovsky (Count Razumovsky)',
      ),
    ]);
    expect(result.toDrop.size).toBe(1);
  });

  it('flags a question whose stem contains a parenthetical accepted form', () => {
    // "the Balrog" is offered as an acceptable answer and the stem hands it over.
    const result = findAnswerLeaks([
      q(
        'In The Fellowship of the Ring, the Fellowship loses one of its members to the Balrog in the Mines of Moria. What is the name of that ancient demon of shadow and flame?',
        "Durin's Bane (the Balrog)",
      ),
    ]);
    expect(result.toDrop.size).toBe(1);
  });

  it('flags a long lowercase form whose every word is already in the stem', () => {
    const result = findAnswerLeaks([
      q(
        'People eat more when dining with others than alone. What is the name for this social facilitation of eating?',
        'Social facilitation of eating (meal size social facilitation)',
      ),
    ]);
    expect(result.toDrop.size).toBe(1);
  });

  it('keeps an answer whose distinguishing word is withheld by the stem', () => {
    // "Locutus of Borg" shares only "Borg" with the stem; the name the player
    // must supply is never shown. Flagging this would drop a good question.
    const result = findAnswerLeaks([
      q(
        "In the TNG episode 'The Best of Both Worlds,' Picard is assimilated by the Borg and given a new designation. What name do the Borg give him?",
        'Locutus of Borg',
      ),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps a short generic answer whose words any stem would naturally contain', () => {
    // Measured false positives from the live bank: these words sit in the stem
    // because the stem has to pose the question, not because the answer leaked.
    const result = findAnswerLeaks([
      q("In 'Paradise Lost,' in which book does Satan's defiant declaration appear?", 'Book I'),
      q(
        "Roughly how long is Victor Wembanyama's wingspan, in feet?",
        '8 feet (approximately 7 feet 10-11 inches)',
      ),
      q('If a vote on a motion is tied, does the motion pass or fail by default?', 'It fails'),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('keeps a quote-inversion question that shows the words in the other order', () => {
    // Complete-the-quote is an explicitly acceptable style; the stem MUST show
    // the first half for the question to work.
    const result = findAnswerLeaks([
      q(
        "In 'East Coker,' Eliot opens with 'In my beginning is my end' and closes with its opposite. What is that closing inversion?",
        'In my end is my beginning',
      ),
    ]);
    expect(result.toDrop.size).toBe(0);
  });

  it('does not flag short answers below the leak-check token threshold', () => {
    // "UI" normalizes to length 2 (< MIN_ANSWER_TOKEN_LENGTH = 3), so
    // textContainsAnswer ignores it even though it appears in the text.
    const result = findAnswerLeaks([
      q('What two-letter abbreviation refers to UI in product work?', 'UI'),
    ]);
    expect(result.toDrop.size).toBe(0);
  });
});
