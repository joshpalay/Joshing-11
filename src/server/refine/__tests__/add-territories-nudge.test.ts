import { describe, expect, it } from 'vitest';

import { openText, resolvedText, ADD_TERRITORIES_OPEN_TEXT } from '../copy';
import {
  ADD_TERRITORIES_INACTIVITY_DAYS,
  REFINE_PRIORITY,
  REFINE_VERB,
  shouldNudgeAddTerritories,
  type RefineCandidate,
} from '../types';

describe('shouldNudgeAddTerritories', () => {
  it('fires when the player has never added a territory', () => {
    expect(shouldNudgeAddTerritories(null)).toBe(true);
  });

  it('fires once inactivity reaches the threshold', () => {
    expect(shouldNudgeAddTerritories(ADD_TERRITORIES_INACTIVITY_DAYS)).toBe(true);
    expect(shouldNudgeAddTerritories(ADD_TERRITORIES_INACTIVITY_DAYS + 30)).toBe(true);
  });

  it('stays quiet while a recent add is inside the window', () => {
    expect(shouldNudgeAddTerritories(0)).toBe(false);
    expect(shouldNudgeAddTerritories(ADD_TERRITORIES_INACTIVITY_DAYS - 1)).toBe(false);
  });
});

describe('add_territories copy + tables', () => {
  const candidate: RefineCandidate = {
    type: 'add_territories',
    subdomainId: '',
    subdomainLabel: '',
  };

  it('uses the fixed nudge prose', () => {
    expect(openText(candidate)).toBe(ADD_TERRITORIES_OPEN_TEXT);
    expect(resolvedText(candidate)).toMatch(/categories/i);
  });

  it('is the lowest-priority item and carries the Add categories verb', () => {
    expect(REFINE_VERB.add_territories).toBe('Add categories');
    const others = [
      REFINE_PRIORITY.friend_expansion,
      REFINE_PRIORITY.difficulty_escalation,
      REFINE_PRIORITY.struggle_pruning,
    ];
    expect(Math.max(...others)).toBeLessThan(REFINE_PRIORITY.add_territories);
  });
});
