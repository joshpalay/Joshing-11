import { describe, expect, it } from 'vitest';

import { parseSelfContainmentVerdict, questionNamesSubject } from '@/server/quality/self-containment';

// Pure parser unit — no LLM, no DB. Guards the JSON contract the classifier
// depends on (a bad parse must return null so the caller fails open).

describe('parseSelfContainmentVerdict', () => {
  it('parses a self-contained verdict', () => {
    const v = parseSelfContainmentVerdict('{"self_contained": true, "reason": "names the work"}');
    expect(v).toEqual({ selfContained: true, reason: 'names the work' });
  });

  it('parses a not-self-contained verdict', () => {
    const v = parseSelfContainmentVerdict('{"self_contained": false, "reason": "never says Phineas and Ferb"}');
    expect(v).toEqual({ selfContained: false, reason: 'never says Phineas and Ferb' });
  });

  it('tolerates surrounding prose / fences (parseJsonObject extracts the object)', () => {
    const v = parseSelfContainmentVerdict('```json\n{"self_contained": false, "reason": "x"}\n```');
    expect(v?.selfContained).toBe(false);
  });

  it('supplies a default reason when reason is missing', () => {
    expect(parseSelfContainmentVerdict('{"self_contained": true}')?.reason).toBe('self-contained');
    expect(parseSelfContainmentVerdict('{"self_contained": false}')?.reason).toBe('not self-contained');
  });

  it('returns null when self_contained is absent or non-boolean', () => {
    expect(parseSelfContainmentVerdict('{"reason": "x"}')).toBeNull();
    expect(parseSelfContainmentVerdict('{"self_contained": "yes"}')).toBeNull();
  });

  it('returns null on unparseable input', () => {
    expect(parseSelfContainmentVerdict('not json')).toBeNull();
  });
});

describe('questionNamesSubject (demote guard)', () => {
  it('vetoes a demote when the question names a child-work token of its subcategory', () => {
    // The Haiku hallucination class: it claimed "Breath of the Wild is not
    // mentioned" when it plainly is. The guard sees the shared token and saves it.
    expect(
      questionNamesSubject(
        'What event causes defeated enemies to respawn in Breath of the Wild?',
        'The Legend of Zelda: Breath of the Wild',
      ),
    ).toBe(true);
  });

  it('does not fire when the question names only characters (the true defect)', () => {
    expect(
      questionNamesSubject(
        "At the start of most episodes, Candace notices the boys' project. Whom does she call?",
        'Phineas and Ferb',
      ),
    ).toBe(false);
  });

  it('ignores generic label words (series/book/show) so they cannot false-save', () => {
    // Only "series"/"book" would match here, and those are stopworded out.
    expect(questionNamesSubject('Who is Erica Hale grandfather?', 'Spy School series')).toBe(false);
  });

  it('is inert without a subcategory', () => {
    expect(questionNamesSubject('anything', null)).toBe(false);
  });
});
