import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn() }));
vi.mock('@/server/auth/session', () => ({ getSession: auth.session }));
vi.mock('@/server/auth/admin', () => ({ isAdminUser: auth.admin }));
vi.mock('@/server/cassian/review', () => ({
  nextCassianCard: vi.fn(), answerCassianCard: vi.fn(),
  saveCassianRating: vi.fn(), getRatedCassianDetails: vi.fn(),
  saveCassianPanelNote: vi.fn(),
}));

import { GET as availability, POST as next } from '../next/route';
import { POST as answer } from '../answer/route';
import { POST as rating } from '../rating/route';
import { POST as panelNote } from '../panel-note/route';

const request = () => new Request('http://localhost/api/admin/cassian', {
  method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
});

describe('Cassian admin boundary', () => {
  beforeEach(() => { auth.session.mockReset(); auth.admin.mockReset(); });

  for (const [name, action] of [
    ['availability', () => availability()],
    ['next', () => next()],
    ['answer', () => answer(request())],
    ['rating', () => rating(request())],
    ['panel note', () => panelNote(request())],
  ] as const) {
    it(`${name} returns 404 to an anonymous caller`, async () => {
      auth.session.mockResolvedValue(null);
      expect((await action()).status).toBe(404);
    });
    it(`${name} returns 404 to a signed-in non-admin`, async () => {
      auth.session.mockResolvedValue({ userId: 'ordinary-user' });
      auth.admin.mockReturnValue(false);
      expect((await action()).status).toBe(404);
    });
  }
});
