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
    expect(buildSmsConsentAuditPatch('opted_in', changedAt)).toEqual({
      smsOptIn: 'opted_in',
      smsOptInAt: changedAt,
      smsConsentSource: SMS_CONSENT_SOURCE,
      smsConsentPolicyVersion: SMS_CONSENT_POLICY_VERSION,
    });
  });

  it('builds one atomic opt-out update with its own timestamp', () => {
    expect(buildSmsConsentAuditPatch('opted_out', changedAt)).toEqual({
      smsOptIn: 'opted_out',
      smsOptOutAt: changedAt,
      smsConsentSource: SMS_CONSENT_SOURCE,
      smsConsentPolicyVersion: SMS_CONSENT_POLICY_VERSION,
    });
  });
});
