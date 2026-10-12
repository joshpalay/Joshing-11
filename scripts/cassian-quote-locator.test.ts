import { describe, expect, it } from 'vitest';
import { locateQuote } from './cassian-quote-locator';

describe('offline quote location', () => {
  it('computes UTF-16 locations from the actual text rather than supplied numbers', () => {
    const text = 'A label. The inventor was Mira in 1842. Other prose.';
    expect(locateQuote(text, 'The inventor was Mira in 1842.')).toEqual({
      status: 'unique', start: 9, end: 39, quote: 'The inventor was Mira in 1842.',
    });
  });
  it('maps harmless whitespace and typographic quotes back to the actual substring', () => {
    const text = '  Lead: “One\n  sentence”\t here.  ';
    const quote = '“One\n  sentence”\t here.';
    expect(locateQuote(text, '"One sentence" here.')).toEqual({
      status: 'unique', start: text.indexOf('“'), end: text.indexOf('here.') + 5, quote,
    });
  });
  it('never chooses the first of repeated quotations', () => {
    expect(locateQuote('Mira wrote it. Mira wrote it.', 'Mira wrote it.')).toEqual({ status: 'ambiguous', matches: 2 });
    expect(locateQuote('aaaa', 'aa')).toEqual({ status: 'ambiguous', matches: 3 });
  });
  it('refuses changes to actors, dates, negation and substantive words', () => {
    for (const quote of ['Mira did write it in 1842.', 'Mira did not write it in 1843.', 'Nora did not write it in 1842.', 'Mira wrote it.'])
      expect(locateQuote('Mira did not write it in 1842.', quote)).toEqual({ status: 'missing', matches: 0 });
  });
  it('preserves character case rather than treating it as harmless evidence typography', () => {
    expect(locateQuote('KING: My words.', 'King: My words.')).toEqual({ status: 'missing', matches: 0 });
  });
  it('maps NFC and emoji positions without splitting graphemes', () => {
    const text = '😀 Cafe\u0301 said “yes”.';
    expect(locateQuote(text, 'Café said "yes".')).toEqual({ status: 'unique', start: 3, end: text.length, quote: text.slice(3) });
    expect(locateQuote('👩‍🔬', '👩')).toEqual({ status: 'missing', matches: 0 });
  });
  it('keeps empty and absent evidence unresolved', () => {
    expect(locateQuote('Evidence', '  \n')).toEqual({ status: 'invalid', matches: 0 });
    expect(locateQuote('', 'Evidence')).toEqual({ status: 'missing', matches: 0 });
  });
  it('does not equate quotation location with support for a different relationship', () => {
    const result = locateQuote('Mira designed a lamp. Nora designed the lens.', 'Nora designed the lens.');
    expect(result.status).toBe('unique');
    // The caller still has to adjudicate an assertion crediting the lamp to Nora.
    expect(result).not.toHaveProperty('supported');
    expect(result).not.toHaveProperty('decision');
  });
});
