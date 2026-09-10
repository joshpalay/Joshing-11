/**
 * Offline, repeatable grading check. It sends no model requests and reads no
 * player data. The legacy normalizer is kept here only to make the before/after
 * comparison reproducible while the production code uses normalizeForMatch.
 */
import { normalizeForMatch } from '../src/server/answers/match-normalization';

const legacyNormalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');

const cases = [
  { label: 'case', submitted: 'tosca', answer: 'Tosca', shouldMatch: true },
  { label: 'article', submitted: 'The Beatles', answer: 'Beatles', shouldMatch: true },
  { label: 'diacritic', submitted: 'Beyonce', answer: 'Beyoncé', shouldMatch: true },
  { label: 'hyphen', submitted: 'Spider Man', answer: 'Spider-Man', shouldMatch: true },
  { label: 'language marker', submitted: 'C', answer: 'C++', shouldMatch: false },
  { label: 'musical accidental', submitted: 'C major', answer: 'C# major', shouldMatch: false },
  { label: 'negative number', submitted: '5', answer: '-5', shouldMatch: false },
  { label: 'decimal number', submitted: '1 5', answer: '1.5', shouldMatch: false },
] as const;

function score(normalize: (value: string) => string) {
  const results = cases.map((item) => {
    const matched = normalize(item.submitted) === normalize(item.answer);
    return { ...item, matched, correct: matched === item.shouldMatch };
  });
  return {
    passed: results.filter((item) => item.correct).length,
    total: results.length,
    failures: results.filter((item) => !item.correct).map((item) => item.label),
  };
}

console.log(
  JSON.stringify({ legacy: score(legacyNormalize), current: score(normalizeForMatch) }, null, 2),
);
