const SESSION_COOKIE_NAME = 'joshing_session';

export type SessionCookie = { name: string; value: string };

function parseSetCookie(header: string | null): SessionCookie | null {
  if (!header) return null;
  for (const piece of header.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
    const trimmed = piece.trim();
    if (!trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) continue;
    const value = trimmed.slice(SESSION_COOKIE_NAME.length + 1).split(';')[0];
    return { name: SESSION_COOKIE_NAME, value };
  }
  return null;
}

export async function authenticateAsTestUser(
  baseUrl: string,
  phone: string,
): Promise<SessionCookie> {
  const otpRes = await fetch(`${baseUrl}/api/auth/request-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  if (!otpRes.ok) {
    throw new Error(`[playtest/auth] request-otp failed ${otpRes.status} for ${phone}: ${await otpRes.text()}`);
  }

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: '000000' }),
  });
  if (!verifyRes.ok) {
    throw new Error(`[playtest/auth] verify-otp failed ${verifyRes.status} for ${phone}: ${await verifyRes.text()}`);
  }

  const cookie = parseSetCookie(verifyRes.headers.get('set-cookie'));
  if (!cookie) {
    throw new Error(`[playtest/auth] verify-otp returned no ${SESSION_COOKIE_NAME} cookie for ${phone}`);
  }
  return cookie;
}
