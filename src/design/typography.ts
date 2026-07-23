/**
 * The semantic typography contract for every product surface.
 *
 * Components should select a role from this file rather than composing
 * font-size, weight, or letter-spacing utilities. Color and layout remain the
 * responsibility of the consuming component.
 */
export const typography = {
  displayTitle: 'type-display-title',
  pageTitle: 'type-page-title',
  sectionHeading: 'type-section-heading',
  cardTitle: 'type-card-title',
  question: 'type-card-title',
  body: 'type-body',
  supporting: 'type-supporting',
  metadata: 'type-metadata',
  eyebrow: 'type-eyebrow',
  button: 'type-button',
  smallButton: 'type-button-sm',
  tab: 'type-tab',
  selectedTab: 'type-tab-selected',
  chip: 'type-chip',
  topNavigation: 'type-nav-top',
  bottomNavigation: 'type-nav-bottom',
  selectedBottomNavigation: 'type-nav-bottom-selected',
} as const;

export type TypographyRole = keyof typeof typography;
