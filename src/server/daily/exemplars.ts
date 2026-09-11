// Curated style exemplars supplied by the product owner. These are
// gold-standard trivia questions used as few-shot reference in the daily
// generator and quality-gate prompts. They demonstrate the register,
// specificity, and concision Joshing aims for — not the literal facts
// to copy. Edit the list here; both prompts read from STYLE_EXEMPLAR_BLOCK.

export type StyleExemplarShape =
  | 'identification'
  | 'year_or_date'
  | 'in_which_work'
  | 'who_did_what'
  | 'sequence_or_order'
  | 'technique_or_term'
  | 'what_happens_next'
  | 'fill_in_blank'
  | 'complete_the_quote'
  | 'name_multiple';

export type StyleExemplar = {
  q: string;
  a: string;
  shape: StyleExemplarShape;
};

export const STYLE_EXEMPLARS: readonly StyleExemplar[] = [
  { q: "Who was the character of Buck Mulligan based on?", a: "Oliver St. John Gogarty", shape: 'identification' },
  { q: "What was the name of Alexander the Great's horse?", a: "Bucephalus", shape: 'identification' },
  { q: "Who were Arnold Schoenberg's two most famous pupils?", a: "Alban Berg; Anton Webern", shape: 'name_multiple' },
  { q: "Fill in the blank in this line from Don Giovanni: Don Giovanni a …… teco", a: "cenar", shape: 'fill_in_blank' },
  { q: "What fruit does the narrator of The Love Song of J. Alfred Prufrock dare to eat?", a: "a peach", shape: 'identification' },
  { q: "In what Bach cantata does Jesu Joy of Man's Desiring first appear?", a: "BWV 147 (Herz und Mund und Tat und Leben)", shape: 'in_which_work' },
  { q: "Which late 20th-century composer developed the tintinnabuli technique?", a: "Arvo Pärt", shape: 'identification' },
  { q: "Which philosopher used the example of a bat's echolocation to argue that subjective experience can never be fully captured by science?", a: "Thomas Nagel", shape: 'identification' },
  { q: "According to T.S. Eliot, which is the cruelest month?", a: "April", shape: 'identification' },
  { q: "Where was the first self-sustained nuclear reaction?", a: "University of Chicago (Chicago Pile-1)", shape: 'identification' },
  { q: "What is the title of Beethoven's Third Symphony?", a: "Eroica", shape: 'identification' },
  { q: "What is the name of the most famous opera house in Venice?", a: "La Fenice", shape: 'identification' },
  { q: "Scarpia is the villain in what Puccini opera?", a: "Tosca", shape: 'in_which_work' },
  { q: "What is the plural of \"focus\"?", a: "foci", shape: 'technique_or_term' },
  { q: "Which apostle was chosen to replace Judas Iscariot?", a: "Matthias", shape: 'identification' },
  { q: "What physical anomaly is Anne Boleyn rumored to have had?", a: "a sixth finger", shape: 'identification' },
  { q: "What is it called when Venice floods?", a: "acqua alta", shape: 'technique_or_term' },
  { q: "Name the four operas that make up Wagner's Ring Cycle.", a: "Das Rheingold; Die Walküre; Siegfried; Götterdämmerung", shape: 'name_multiple' },
  { q: "Which German Jewish philosopher described the \"angel of history\" being blown backward into the future by the storm of progress?", a: "Walter Benjamin", shape: 'identification' },
  { q: "Septimus Warren Smith is a major character in which novel?", a: "Mrs. Dalloway", shape: 'in_which_work' },
  { q: "How many balls appear on the most common version of the Medici coat of arms?", a: "six", shape: 'identification' },
  { q: "Which band has a song featuring the lyric \"how did I get to this beautiful house?\"", a: "Talking Heads", shape: 'identification' },
  { q: "What embiggens us all?", a: "a noble spirit", shape: 'complete_the_quote' },
  { q: "Clovis, Clotaire, and Chilperic were all kings of which Frankish dynasty?", a: "Merovingian", shape: 'identification' },
  { q: "Complete the Shakespeare quote: \"A horse, a horse, ……\"", a: "my kingdom for a horse", shape: 'complete_the_quote' },
  { q: "Which philosopher developed the \"veil of ignorance\" concept?", a: "John Rawls", shape: 'identification' },
  { q: "To which cartoon theme tune can the opening verses of Paradise Lost be sung?", a: "Gilligan's Island", shape: 'identification' },
  { q: "Which Gershwin melody is said to be based on the Jewish Aleinu prayer?", a: "It Ain't Necessarily So", shape: 'identification' },
  { q: "Name at least two musicians who played on Miles Davis's Kind of Blue.", a: "John Coltrane; Cannonball Adderley; Bill Evans; Paul Chambers; Jimmy Cobb; Wynton Kelly", shape: 'name_multiple' },
  { q: "What voice type, combining power and stamina, is required for Wagner's Siegfried?", a: "Heldentenor", shape: 'technique_or_term' },
  { q: "Who has \"information, vegetable, animal and mineral\"?", a: "the Modern Major-General", shape: 'identification' },
  { q: "Which famous piano work by Debussy quotes and mocks a theme from Wagner's Tristan und Isolde?", a: "Golliwogg's Cakewalk", shape: 'in_which_work' },
  { q: "Kitty O'Shea had an affair with what famous Irish statesman?", a: "Charles Stewart Parnell", shape: 'identification' },
  { q: "What is the name of the rope that raises or lowers a sail on a sailboat?", a: "halyard", shape: 'identification' },
  // Calibration additions (Section 20, questions 35–63) — broaden domain and
  // shape range beyond the founding literary/classical set.
  { q: "In what song does Weird Al churn butter once or twice?", a: "Amish Paradise", shape: 'in_which_work' },
  { q: "In Star Trek: The Next Generation, who was not a Merry Man?", a: "Worf", shape: 'who_did_what' },
  { q: "In Frigaliment Importing Co. v. B.N.S. International Sales Corp. (1960), Judge Henry Friendly opened his ruling with what famous question?", a: "What is chicken?", shape: 'complete_the_quote' },
  { q: "What is the name of the opera singer who was supposed to sing the National Anthem in The Naked Gun?", a: "Enrico Pallazzo", shape: 'identification' },
  { q: "If I wanted to talk to Galadriel in her native language, what would it be?", a: "Quenya", shape: 'identification' },
  { q: "If you have a date in Constantinople, where will she be waiting?", a: "Istanbul", shape: 'complete_the_quote' },
  { q: "Which architect designed a building in Berlin that has a gigantic fish sculpture inside it?", a: "Frank Gehry", shape: 'identification' },
  { q: "What was the name of the evil business tycoon in the animated series Gargoyles?", a: "David Xanatos", shape: 'identification' },
  { q: "What chords make up a plagal cadence?", a: "IV to I", shape: 'technique_or_term' },
  { q: "What is the main character's name in the Metroid video game series?", a: "Samus Aran", shape: 'identification' },
  // ---------------------------------------------------------------------------
  // Gap-filling additions (R3, 2026-09-11) — see
  // audits/2026-09-11-Fable-QUESTION-DRIFT-PIPELINE-01.md §2 P5 and §3.5.
  //
  // A hand-read of 220 live machine questions found ~77% were name-this-thing
  // identification, and three shapes the generator is explicitly offered had
  // produced ONE row each across 2,191: what_happens_next, sequence_or_order and
  // a meaningful year_or_date. The catalogue names those shapes but this list
  // demonstrated none of them, so the model had no model to copy. Two further
  // gaps showed up in the same read: discipline domains (UX, counterpoint,
  // food science) collapsed into bare glossary definitions because every
  // technique_or_term exemplar here is pure term-recall, and fandom questions
  // came out in the same long literate register as the opera ones because
  // nothing here shows a short fandom question.
  //
  // These are ADDITIONS only. Nothing hand-curated above was removed — see the
  // RETIREMENT CANDIDATES note at the foot of this file for the entries the
  // audit flagged, left for the product owner to judge.

  // what_happens_next — the beat AFTER a setup, not the name of a thing in it.
  { q: "In Raiders of the Lost Ark, a swordsman theatrically flourishes his scimitar in the Cairo marketplace. What does Indy do instead of reaching for his whip?", a: "shoots him", shape: 'what_happens_next' },
  { q: "In The Godfather, Jack Woltz refuses Tom Hagen's request and goes to bed pleased with himself. What does he find under the sheets the next morning?", a: "the severed head of his racehorse", shape: 'what_happens_next' },

  // sequence_or_order — ordering is the ask; the answer stays a single item, so
  // it never becomes the list shape the grader cannot score.
  { q: "In The Wizard of Oz, which companion does Dorothy meet first on the yellow brick road?", a: "the Scarecrow", shape: 'sequence_or_order' },
  { q: "Das Rheingold opens Wagner's Ring Cycle. Which opera closes it?", a: "Götterdämmerung", shape: 'sequence_or_order' },

  // year_or_date — only when the date IS the point. Here the juxtaposition is
  // the fact; "in what year was X written" remains a filler question.
  { q: "Bach and Handel were born in the same year, a few hundred miles apart. Which year?", a: "1685", shape: 'year_or_date' },

  // Discipline domains with a fan angle — a named person, a famous argument, a
  // landmark book. The point is that a field question can be about something a
  // practitioner would actually trade, not a definition with the label removed.
  { q: "In UX design, the ten usability heuristics every design review still cites are named after which researcher?", a: "Jakob Nielsen", shape: 'identification' },
  { q: "Which 1984 book made food science legible to cooks and is still the reference on every serious kitchen shelf?", a: "On Food and Cooking (Harold McGee)", shape: 'in_which_work' },
  { q: "What is the name of the famously unresolved chord that opens Wagner's Tristan und Isolde and is still argued over?", a: "the Tristan chord", shape: 'technique_or_term' },

  // Short fandom register — easy, specific, and nine words long. Counterweight
  // to the 31-word two-sentence setups the live corpus drifted into.
  { q: "In The Simpsons, what does Homer say when something goes wrong?", a: "D'oh!", shape: 'identification' },
  { q: "What is Optimus Prime's alt mode?", a: "a semi truck", shape: 'identification' },
];

/**
 * RETIREMENT CANDIDATES — flagged by the 2026-09-11 drift audit, NOT removed.
 *
 * These are hand-curated taste calibration, so the audit recommends rather than
 * applies. Each is an encyclopedia-lead fact: the thing a reference work states
 * first, with no angle of its own. Keeping them models the exact pattern R1 now
 * forbids at the accessible tier.
 *
 *   "What was the name of Alexander the Great's horse?"        (roster lead)
 *   "What is the title of Beethoven's Third Symphony?"         (title lead)
 *   "What is the name of the most famous opera house in Venice?" (superlative lead)
 *   "Clovis, Clotaire, and Chilperic were all kings of which Frankish dynasty?"
 *   "What is the plural of \"focus\"?"                           (dictionary lookup)
 *   "What is the name of the rope that raises or lowers a sail on a sailboat?"
 *
 * Separately, five exemplar facts are reproduced in live generated stock despite
 * the "do NOT copy" instruction — tintinnabuli/Arvo Pärt (including one verbatim
 * question), Eroica, "embiggens", the plagal cadence, and Xanatos. R6 addresses
 * that by forbidding example facts in the prompt itself; no edit here is needed
 * unless the owner wants them gone for taste reasons too.
 */

export const STYLE_EXEMPLAR_BLOCK: string = STYLE_EXEMPLARS
  .map((e) => `- [${e.shape}] ${e.q} (A: ${e.a})`)
  .join('\n');

// List questions remain useful review examples, but the current free-text
// grader has no reliable partly-correct-list rule. Do not prime generation to
// produce them until that scoring rule exists.
export const SINGLE_ANSWER_STYLE_EXEMPLAR_BLOCK: string = STYLE_EXEMPLARS
  .filter((e) => e.shape !== 'name_multiple')
  .map((e) => `- [${e.shape}] ${e.q} (A: ${e.a})`)
  .join('\n');
