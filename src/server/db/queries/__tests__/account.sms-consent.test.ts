import { describe, expect, it } from 'vitest';

import {
  buildSmsConsentAuditPatch,
  SMS_CONSENT_POLICY_VERSION,
  SMS_CONSENT_SOURCE,
} from '@/server/db/queries/account';

describe('SMS consent audit persistence', () => {
  const changedAt = new Date('2026-09-01T12:00:00.000Z');

  it('records the current explicit-agreement policy version', () => {
    expect(SMS_CONSENT_POLICY_VERSION).toBe('2026-09-02');
  });

  it('builds one atomic opt-in update with timestamp, source, and policy version', () => {
    expect(buildSmsConsentAuditPatch('opted_in', 'onboarding_web_form', changedAt)).toEqual({
      smsOptIn: 'opted_in',
      smsOptInAt: changedAt,
      smsConsentSource: 'onboarding_web_form',
      smsConsentPolicyVersion: SMS_CONSENT_POLICY_VERSION,
    });
  });

  it('records opt-out without overwriting the retained opt-in proof', () => {
    expect(buildSmsConsentAuditPatch('opted_out', SMS_CONSENT_SOURCE, changedAt)).toEqual({
      smsOptIn: 'opted_out',
      smsOptOutAt: changedAt,
    });
  });
});
