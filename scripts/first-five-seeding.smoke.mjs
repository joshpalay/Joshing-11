import assert from 'node:assert/strict';

import {
  FIRST_RUN_LIGHT_SIGNAL_VARIETY,
  FIRST_RUN_STRONG_SIGNAL_COUNT,
  planFirstRunDomains,
} from '../src/server/daily/first-run-seeding.ts';

const COUNT = 5;

assert.equal(FIRST_RUN_STRONG_SIGNAL_COUNT, 3);
assert.equal(FIRST_RUN_LIGHT_SIGNAL_VARIETY, 2);

// --- 12 selected areas: strong-signal leads, a little light-signal variety ----
{
  const ordered = [
    'Renaissance Art',
    'NASA Missions',
    'French Pastry',
    'Jazz',
    'Roman History',
    'Cycling',
    'Mycology',
    'Opera',
    'Chess',
    'Cartography',
    'Volcanoes',
    'Typography',
  ];
  const plan = planFirstRunDomains(ordered, COUNT);
  // Never more than the queue size.
  assert.ok(plan.length <= COUNT, '12-area plan stays within count');
  // Strong-signal areas (first 3 picked) lead the palette.
  assert.deepEqual(plan.slice(0, 3), ['Renaissance Art', 'NASA Missions', 'French Pastry']);
  // Followed by light-signal variety (the next picks), not a random cross-section.
  assert.deepEqual(plan.slice(3), ['Jazz', 'Roman History']);
}

// --- 3 selected areas: first session draws from exactly those areas -----------
{
  const ordered = ['Renaissance Art', 'NASA Missions', 'French Pastry'];
  const plan = planFirstRunDomains(ordered, COUNT);
  assert.deepEqual(plan, ['Renaissance Art', 'NASA Missions', 'French Pastry']);
  // More than one domain, so the five questions can't all come from one area.
  assert.ok(plan.length > 1, '3-area plan is multi-domain');
}

// --- 4 selected areas: 3 strong + 1 light -------------------------------------
{
  const plan = planFirstRunDomains(['A', 'B', 'C', 'D'], COUNT);
  assert.deepEqual(plan, ['A', 'B', 'C', 'D']);
}

// --- 2 selected areas: never collapses to a single domain ---------------------
{
  const plan = planFirstRunDomains(['A', 'B'], COUNT);
  assert.deepEqual(plan, ['A', 'B']);
}

// --- 1 selected area: the only option -----------------------------------------
{
  const plan = planFirstRunDomains(['A'], COUNT);
  assert.deepEqual(plan, ['A']);
}

// --- Selection ORDER drives priority ------------------------------------------
{
  const first = planFirstRunDomains(['A', 'B', 'C', 'D', 'E'], COUNT);
  const reordered = planFirstRunDomains(['E', 'D', 'C', 'B', 'A'], COUNT);
  assert.notDeepEqual(first, reordered, 'different selection order yields a different plan');
  assert.deepEqual(first.slice(0, 3), ['A', 'B', 'C']);
  assert.deepEqual(reordered.slice(0, 3), ['E', 'D', 'C']);
}

// --- Dedupe (case-insensitive), preserving first occurrence + casing ----------
{
  const plan = planFirstRunDomains(['Jazz', 'jazz', 'JAZZ', 'Opera'], COUNT);
  assert.deepEqual(plan, ['Jazz', 'Opera']);
}

// --- Graceful sparsity: empty in, empty out (caller falls back) ----------------
{
  assert.deepEqual(planFirstRunDomains([], COUNT), []);
  assert.deepEqual(planFirstRunDomains(['  ', ''], COUNT), []);
  assert.deepEqual(planFirstRunDomains(['A', 'B', 'C'], 0), []);
}

console.log('first-five-seeding.smoke: ok');
