/**
 * Normalize cosmetic answer differences while preserving symbols that change
 * the fact itself. This module stays dependency-free so the offline evaluation
 * can run without a database or model client.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(^|\s)-(?=\d)/g, '$1 minussign ')
    .replace(/(?<=\d)\.(?=\d)/g, ' decimalsign ')
    .replace(/\+/g, ' plussign ')
    .replace(/#/g, ' sharpsign ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}
