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
  {
    q: 'Who was the character of Buck Mulligan based on?',
    a: 'Oliver St. John Gogarty',
    shape: 'identification',
  },
  {
    q: "What was the name of Alexander the Great's horse?",
    a: 'Bucephalus',
    shape: 'identification',
  },
  {
    q: "Who were Arnold Schoenberg's two most famous pupils?",
    a: 'Alban Berg; Anton Webern',
    shape: 'name_multiple',
  },
  {
    q: 'Fill in the blank in this line from Don Giovanni: Don Giovanni a …… teco',
    a: 'cenar',
    shape: 'fill_in_blank',
  },
  {
    q: 'What fruit does the narrator of The Love Song of J. Alfred Prufrock dare to eat?',
    a: 'a peach',
    shape: 'identification',
  },
  {
    q: "In what Bach cantata does Jesu Joy of Man's Desiring first appear?",
    a: 'BWV 147 (Herz und Mund und Tat und Leben)',
    shape: 'in_which_work',
  },
  {
    q: 'Which late 20th-century composer developed the tintinnabuli technique?',
    a: 'Arvo Pärt',
    shape: 'identification',
  },
  {
    q: "Which philosopher used the example of a bat's echolocation to argue that subjective experience can never be fully captured by science?",
    a: 'Thomas Nagel',
    shape: 'identification',
  },
  {
    q: 'According to T.S. Eliot, which is the cruelest month?',
    a: 'April',
    shape: 'identification',
  },
  {
    q: 'Where was the first self-sustained nuclear reaction?',
    a: 'University of Chicago (Chicago Pile-1)',
    shape: 'identification',
  },
  { q: "What is the title of Beethoven's Third Symphony?", a: 'Eroica', shape: 'identification' },
  {
    q: 'What is the name of the most famous opera house in Venice?',
    a: 'La Fenice',
    shape: 'identification',
  },
  { q: 'Scarpia is the villain in what Puccini opera?', a: 'Tosca', shape: 'in_which_work' },
  { q: 'What is the plural of "focus"?', a: 'foci', shape: 'technique_or_term' },
  {
    q: 'Which apostle was chosen to replace Judas Iscariot?',
    a: 'Matthias',
    shape: 'identification',
  },
  {
    q: 'What physical anomaly is Anne Boleyn rumored to have had?',
    a: 'a sixth finger',
    shape: 'identification',
  },
  { q: 'What is it called when Venice floods?', a: 'acqua alta', shape: 'technique_or_term' },
  {
    q: "Name the four operas that make up Wagner's Ring Cycle.",
    a: 'Das Rheingold; Die Walküre; Siegfried; Götterdämmerung',
    shape: 'name_multiple',
  },
  {
    q: 'Which German Jewish philosopher described the "angel of history" being blown backward into the future by the storm of progress?',
    a: 'Walter Benjamin',
    shape: 'identification',
  },
  {
    q: 'Septimus Warren Smith is a major character in which novel?',
    a: 'Mrs. Dalloway',
    shape: 'in_which_work',
  },
  {
    q: 'How many balls appear on the most common version of the Medici coat of arms?',
    a: 'six',
    shape: 'identification',
  },
  {
    q: 'Which band has a song featuring the lyric "how did I get to this beautiful house?"',
    a: 'Talking Heads',
    shape: 'identification',
  },
  { q: 'What embiggens us all?', a: 'a noble spirit', shape: 'complete_the_quote' },
  {
    q: 'Clovis, Clotaire, and Chilperic were all kings of which Frankish dynasty?',
    a: 'Merovingian',
    shape: 'identification',
  },
  {
    q: 'Complete the Shakespeare quote: "A horse, a horse, ……"',
    a: 'my kingdom for a horse',
    shape: 'complete_the_quote',
  },
  {
    q: 'Which philosopher developed the "veil of ignorance" concept?',
    a: 'John Rawls',
    shape: 'identification',
  },
  {
    q: 'To which cartoon theme tune can the opening verses of Paradise Lost be sung?',
    a: "Gilligan's Island",
    shape: 'identification',
  },
  {
    q: 'Which Gershwin melody is said to be based on the Jewish Aleinu prayer?',
    a: "It Ain't Necessarily So",
    shape: 'identification',
  },
  {
    q: "Name at least two musicians who played on Miles Davis's Kind of Blue.",
    a: 'John Coltrane; Cannonball Adderley; Bill Evans; Paul Chambers; Jimmy Cobb; Wynton Kelly',
    shape: 'name_multiple',
  },
  {
    q: "What voice type, combining power and stamina, is required for Wagner's Siegfried?",
    a: 'Heldentenor',
    shape: 'technique_or_term',
  },
  {
    q: 'Who has "information, vegetable, animal and mineral"?',
    a: 'the Modern Major-General',
    shape: 'identification',
  },
  {
    q: "Which famous piano work by Debussy quotes and mocks a theme from Wagner's Tristan und Isolde?",
    a: "Golliwogg's Cakewalk",
    shape: 'in_which_work',
  },
  {
    q: "Kitty O'Shea had an affair with what famous Irish statesman?",
    a: 'Charles Stewart Parnell',
    shape: 'identification',
  },
  {
    q: 'What is the name of the rope that raises or lowers a sail on a sailboat?',
    a: 'halyard',
    shape: 'identification',
  },
];

export const STYLE_EXEMPLAR_BLOCK: string = STYLE_EXEMPLARS.map(
  (e) => `- [${e.shape}] ${e.q} (A: ${e.a})`,
).join('\n');
