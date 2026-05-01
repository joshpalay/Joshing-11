import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PersonalMasteryPage } from '@/components/profile/PersonalMasteryPage';

type Tier = 'establishing' | 'familiar' | 'solid' | 'mastery';

const TIER_POINTS: Record<Tier, number> = {
  establishing: 0,
  familiar: 600,
  solid: 2000,
  mastery: 4000,
};

function masteryRow(canonical_subcategory: string, current_tier: Tier, mastery_points?: number) {
  return {
    canonical_subcategory,
    current_tier,
    mastery_points: mastery_points ?? TIER_POINTS[current_tier],
    tier_reached_at: null,
    season_points_gained: 0,
  };
}

function category(canonical_subcategory: string, broad_category = 'Music', declared_score = 1, proven_score = 1) {
  return {
    canonical_subcategory,
    broad_category,
    declared_score,
    proven_score,
    proven_score_catchup: 0,
    emerging_proven: false,
    question_count: 0,
    answer_count: 0,
    authored_answered_count: 0,
    difficulty_breakdown: {
      declared: { specialist: 1, moderate: 0, accessible: 0 },
      proven: { specialist: 0, moderate: 1, accessible: 0 },
    },
  };
}

describe('PersonalMasteryPage B5 hard gates + copy lock', () => {
  it('locks empty own-state copy to exact directional invitation language', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-1"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{ categories: [], max_declared_score: 0, max_proven_score: 0 }}
        initialMastery={{ mastery: [] }}
      />,
    );

    expect(html).toContain('Your portrait is empty. It builds from what you write and what you prove — every question you ask, every answer you get right.');
    expect(html).toContain('Go to your active games');
  });

  it('renders sparse own state with hyper-specific categories; establishing tier has no tier label (B10)', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-1"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [
            category('Late Tchaikovsky', 'Music', 5, 3),
            category('Counterpoint species writing', 'Music Theory', 4, 2),
          ],
          max_declared_score: 5,
          max_proven_score: 3,
        }}
        initialMastery={{
          mastery: [
            masteryRow('Late Tchaikovsky', 'establishing'),
            masteryRow('Counterpoint species writing', 'familiar'),
          ],
        }}
      />,
    );

    expect(html).toContain('Late Tchaikovsky');
    expect(html).toContain('Counterpoint species writing');
    expect(html).toContain('Your portrait is early. It grows with every question you write and every answer you get right.');
    expect(html).toContain('Proven territory includes any catch-up answers at half weight.');
    expect(html).toContain('How mastery works →');
    expect(html).toContain('Mastery tier: Familiar');
    expect(html).not.toContain('Mastery tier: Establishing');
    expect(html).toContain('pts to Familiar');
  });

  it('renders friend view overlap copy-lock and unexplored invitation copy', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-2"
        displayName="Maya"
        firstName="Maya"
        mode="friend"
        initialPortrait={{
          categories: [
            {
              ...category('Bowie-era Glam Rock', 'Music', 4, 4),
              visitor_overlap: {
                has_played_here: true,
                has_correct_here: true,
                questions_answered: 3,
                questions_correct: 2,
                overlap_top_peer_name: null,
              },
            },
          ],
          max_declared_score: 4,
          max_proven_score: 4,
          visitor_unexplored: [{ canonical_subcategory: 'Constitutional compromises of 1787', broad_category: 'History' }],
        }}
        initialMastery={{ mastery: [masteryRow('Bowie-era Glam Rock', 'solid')] }}
      />,
    );

    expect(html).toContain('Shared ground in 1 territory.');
    expect(html).toContain('you know this territory too');
    expect(html).toContain('YOUR WORLD, NOT THEIRS YET');
    expect(html).toContain('Territories you\&#x27;ve explored that Maya hasn\&#x27;t entered yet.');
    expect(html).not.toContain('0% overlap');
  });

  it('renders friend mode empty portrait state without own-empty invitation copy', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-2"
        displayName="Maya"
        firstName="Maya"
        mode="friend"
        initialPortrait={{ categories: [], max_declared_score: 0, max_proven_score: 0 }}
        initialMastery={{ mastery: [] }}
      />,
    );

    expect(html).toContain('Maya\&#x27;s portrait is still early.');
    expect(html).not.toContain('Your portrait is empty. It builds from what you write and what you prove — every question you ask, every answer you get right.');
    expect(html).not.toContain('Go to your active games');
  });

  it('renders rich-state collapsed sections and top-tier styling copy lock', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-1"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [
            category('Late Tchaikovsky', 'Music', 10, 10),
            category('Bowie-era Glam Rock', 'Music', 9, 8),
            category('Counterpoint species writing', 'Music', 8, 8),
            category('Constitutional compromises of 1787', 'Music', 7, 6),
            category('Russian Silver Age poetry', 'History', 6, 5),
            category('Ottoman court miniatures', 'History', 5, 4),
            category('Florentine banking ledgers', 'History', 5, 4),
            category('Qin legalist reforms', 'History', 4, 4),
            category('Debussy harmonic color', 'Music', 4, 3),
            category('Byzantine icon restoration', 'History', 3, 3),
            category('Sogdian trade routes', 'History', 3, 2),
          ],
          max_declared_score: 10,
          max_proven_score: 10,
        }}
        initialMastery={{
          mastery: [
            masteryRow('Late Tchaikovsky', 'mastery'),
            masteryRow('Bowie-era Glam Rock', 'solid'),
          ],
        }}
      />,
    );

    expect(html).toContain('Mastery');
    expect(html).toContain('Mastery tier: Mastery');
    expect(html).toContain('more in History');
  });

  it('gracefully degrades when portrait and mastery payloads are out of sync', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-3"
        displayName="Ari"
        firstName="Ari"
        mode="own"
        initialPortrait={{
          categories: [category('Actual portrait category', 'History', 3, 2)],
          max_declared_score: 3,
          max_proven_score: 2,
        }}
        initialMastery={{
          mastery: [masteryRow('Mastery-only phantom category', 'mastery')],
        }}
      />,
    );

    expect(html).toContain('Actual portrait category');
    expect(html).not.toContain('Mastery tier: Mastery');
    expect(html).not.toContain('Mastery-only phantom category');
  });

  it('renders long category names with full text and wrap-capable title-row style', () => {
    const longCategoryName = 'Neo-Assyrian hydrological adaptation strategies across upper Mesopotamian tributary settlements with reconstructed paleoclimate datasets';
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-4"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [category(longCategoryName, 'Ancient Civilizations', 2, 1)],
          max_declared_score: 2,
          max_proven_score: 1,
        }}
        initialMastery={{ mastery: [masteryRow(longCategoryName, 'familiar')] }}
      />,
    );

    expect(html).toContain(longCategoryName);
    expect(html).toContain('flex-wrap:wrap');
  });

  it('includes a11y labels for progress bars and tier tags', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-1"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [category('Late Tchaikovsky', 'Music', 5, 2)],
          max_declared_score: 5,
          max_proven_score: 4,
        }}
        initialMastery={{ mastery: [masteryRow('Late Tchaikovsky', 'familiar', 1200)] }}
      />,
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('Progress toward Solid');
    expect(html).toContain('Mastery tier: Familiar');
  });

  it('does not show internal over-claim cues in primary card UI (B10)', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-q"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [category('Counterpoint species writing', 'Music Theory', 12, 0)],
          max_declared_score: 12,
          max_proven_score: 1,
        }}
        initialMastery={{ mastery: [masteryRow('Counterpoint species writing', 'solid')] }}
      />,
    );

    expect(html).not.toContain('⚑ More declared than proven');
  });

  it('renders a-only categories without overclaimed cue', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-a"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [category('Late Tchaikovsky', 'Music', 0, 9)],
          max_declared_score: 1,
          max_proven_score: 9,
        }}
        initialMastery={{ mastery: [masteryRow('Late Tchaikovsky', 'familiar')] }}
      />,
    );

    expect(html).not.toContain('⚑ More declared than proven');
  });

  it('keeps interactive controls at 44x44 minimum touch targets', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-touch"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [
            category('Late Tchaikovsky', 'History', 10, 10),
            category('Bowie-era Glam Rock', 'History', 9, 8),
            category('Counterpoint species writing', 'History', 8, 8),
            category('Constitutional compromises of 1787', 'History', 7, 6),
          ],
          max_declared_score: 10,
          max_proven_score: 10,
        }}
        initialMastery={{ mastery: [masteryRow('Late Tchaikovsky', 'mastery')] }}
      />,
    );

    expect(html).toContain('min-height:44px');
    expect(html).toContain('min-width:44px');
  });

  it('handles large overlap counts with exact subtitle grammar', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-2"
        displayName="Maya"
        firstName="Maya"
        mode="friend"
        initialPortrait={{
          categories: Array.from({ length: 12 }, (_, i) => ({
            ...category(`Shared category ${i + 1}`, 'History', 2, 2),
            visitor_overlap: {
              has_played_here: true,
              has_correct_here: true,
              questions_answered: 4,
              questions_correct: 3,
              overlap_top_peer_name: null,
            },
          })),
          max_declared_score: 2,
          max_proven_score: 2,
          visitor_unexplored: [],
        }}
        initialMastery={{ mastery: [masteryRow('Shared category 1', 'solid')] }}
      />,
    );

    expect(html).toContain('Shared ground in 12 territories.');
  });

  it('does not surface accuracy-style percentages in portrait bars', () => {
    const html = renderToStaticMarkup(
      <PersonalMasteryPage
        userId="u-forbidden"
        displayName="Josh"
        firstName="Josh"
        mode="own"
        initialPortrait={{
          categories: [category('Late Tchaikovsky', 'Music', 3, 1)],
          max_declared_score: 3,
          max_proven_score: 2,
        }}
        initialMastery={{ mastery: [masteryRow('Late Tchaikovsky', 'establishing')] }}
      />,
    );

    expect(html).not.toContain('approximately');
    expect(html).not.toContain('% full');
    expect(html).not.toContain('% alignment');
    expect(html).not.toContain('Mastery tier: Establishing');
    expect(html).toContain('pts to Familiar');
  });
});
