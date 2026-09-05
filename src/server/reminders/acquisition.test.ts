import { describe, expect, it } from 'vitest'

import {
  deriveReminderAcquisitionState,
  shouldOfferReminderAcquisition,
  type ReminderAcquisitionSignals,
} from '@/server/reminders/acquisition'

const eligible: ReminderAcquisitionSignals = {
  phoneNumber: '+17345550123',
  phoneVerified: true,
  smsOptIn: 'not_asked',
  emailOptIn: 'not_asked',
  pendingEmail: null,
  reminderPromptDismissedAt: null,
  reminderInterstitialSeenAt: null,
}

describe('reminder acquisition state', () => {
  it('offers reminders to a verified player who has never answered the ask', () => {
    expect(deriveReminderAcquisitionState(eligible)).toBe('eligible')
    expect(shouldOfferReminderAcquisition(eligible)).toBe(true)
  })

  it.each([
    { label: 'SMS subscriber', patch: { smsOptIn: 'opted_in' as const } },
    { label: 'email subscriber', patch: { emailOptIn: 'opted_in' as const } },
    { label: 'pending email subscriber', patch: { pendingEmail: 'player@example.com' } },
  ])('does not ask an existing $label to choose another channel', ({ patch }) => {
    expect(deriveReminderAcquisitionState({ ...eligible, ...patch })).toBe('active')
  })

  it.each([
    { label: 'explicit SMS opt-out', patch: { smsOptIn: 'opted_out' as const } },
    { label: 'legacy final decline', patch: { reminderPromptDismissedAt: new Date() } },
    { label: 'consumed follow-up', patch: { reminderInterstitialSeenAt: new Date() } },
  ])('retires acquisition after $label', ({ patch }) => {
    expect(deriveReminderAcquisitionState({ ...eligible, ...patch })).toBe('retired')
  })

  it('does not offer SMS without a verified destination', () => {
    expect(deriveReminderAcquisitionState({ ...eligible, phoneVerified: false })).toBe(
      'unavailable',
    )
  })
})
