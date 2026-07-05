// Shared "adopt a domain" path (the territory-adopt call): sets the domain's
// Daily Five frequency, which folds it into the knowledge-base rotation. Used
// by every confirmed-add affordance on the knowledge surfaces (the bubble
// map's action card and the peaks view's addable siblings), so the network
// contract lives in exactly one place.
export async function adoptDomain(domain: string): Promise<boolean> {
  try {
    const res = await fetch('/api/daily/preferences/domain-frequency', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ domain, frequency: 'sometimes' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
