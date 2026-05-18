export type BioDomain = {
  displayName: string;
  points: number;
};

export function formatBio(params: {
  topDomains: BioDomain[];
  declaredInterests: string[];
}): string {
  const top = params.topDomains
    .filter((domain) => domain.points > 0)
    .slice(0, 3)
    .map((domain) => domain.displayName);

  if (top.length >= 2) {
    return `A mind building around ${top.slice(0, -1).join(', ')} and ${top.at(-1)}.`;
  }
  if (top.length === 1) {
    return `A mind building around ${top[0]}.`;
  }
  if (params.declaredInterests.length > 0) {
    return `Your mind is ready to explore ${params.declaredInterests.slice(0, 3).join(', ')}.`;
  }
  return 'Your mind will take shape as you play and write questions.';
}
