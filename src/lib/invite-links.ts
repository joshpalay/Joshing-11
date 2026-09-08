export const MAX_INVITE_LINK_CATEGORIES = 3;

export type InviteLinkCategory = {
  label: string;
  broadCategory?: string | null;
  description?: string | null;
};

const INVALID_CATEGORY_KEYS = new Set([
  'no category',
  'none',
  'null',
  'undefined',
  'n/a',
  'na',
  'placeholder',
  'select a category',
  'uncategorized',
]);

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength) : '';
}

/**
 * Invitation categories cross a legacy JSON boundary, so every read is
 * defensive. Blank values, the retired "No category" sentinel, malformed
 * records, and duplicates are omitted without invalidating the link itself.
 */
export function sanitizeInviteLinkCategories(value: unknown): InviteLinkCategory[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const categories: InviteLinkCategory[] = [];

  for (const item of value) {
    const record =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : null;
    const label = cleanText(typeof item === 'string' ? item : record?.label, 80);
    const key = label.toLocaleLowerCase('en-US');
    if (!label || INVALID_CATEGORY_KEYS.has(key) || seen.has(key)) continue;

    const broadCategory = cleanText(record?.broadCategory ?? record?.broad_category, 80);
    const hasDescription = Boolean(
      record && Object.prototype.hasOwnProperty.call(record, 'description'),
    );
    const description = cleanText(record?.description, 180);
    seen.add(key);
    categories.push({
      label,
      broadCategory: broadCategory || null,
      ...(hasDescription ? { description: description || null } : {}),
    });
    if (categories.length === MAX_INVITE_LINK_CATEGORIES) break;
  }

  return categories;
}

export function hasValidInviteLinkCategories(value: unknown): boolean {
  return sanitizeInviteLinkCategories(value).length > 0;
}

/** A public display name only; never fall back to a handle, phone, or id. */
export function safeInviteName(value: unknown): string | null {
  const name = cleanText(value, 80);
  if (!name) return null;

  const key = name.toLocaleLowerCase('en-US');
  if (INVALID_CATEGORY_KEYS.has(key)) return null;
  // Phone-like strings and email/handle-shaped identifiers are account data,
  // not a friendly public name. Use the neutral product fallback instead.
  if (/^\+?[\d\s().-]{7,}$/.test(name) || name.includes('@')) return null;
  return name;
}

export function inviteGreatestHitsTitle(name: unknown, creatorView = false): string {
  const safeName = safeInviteName(name);
  if (!safeName) return creatorView ? 'Play your greatest hits' : 'Play the greatest hits';
  return `Play ${safeName}’s greatest hits`;
}

/** Recipient-facing action copy; never interpolate account identifiers. */
export function inviteAcceptanceLabel(name: unknown): string {
  const safeName = safeInviteName(name);
  return safeName ? `Accept ${safeName}’s invitation` : 'Accept invitation';
}
