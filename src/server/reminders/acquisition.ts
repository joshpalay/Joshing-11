export const SMS_CONSENT_POLICY_VERSION = '2026-09-02'

export type ReminderOptInState = 'opted_in' | 'opted_out' | 'not_asked'

export const SMS_CONSENT_SOURCES = [
  'profile_web_form',
  'onboarding_web_form',
  'daily_summary_web_form',
] as const

export type SmsConsentSource = (typeof SMS_CONSENT_SOURCES)[number]

export type ReminderAcquisitionSignals = {
  phoneNumber: string | null
  phoneVerified: boolean
  smsOptIn: ReminderOptInState
  emailOptIn: ReminderOptInState
  pendingEmail: string | null
  reminderPromptDismissedAt: Date | string | null
  reminderInterstitialSeenAt: Date | string | null
}

export type ReminderAcquisitionState =
  | 'eligible'
  | 'unavailable'
  | 'active'
  | 'retired'

/**
 * The single acquisition rule shared by onboarding and every contextual ask.
 * Settings is intentionally not gated by this function: it is a management
 * surface where a player may change channels at any time, not another prompt.
 */
export function deriveReminderAcquisitionState(
  signals: ReminderAcquisitionSignals,
): ReminderAcquisitionState {
  if (!signals.phoneVerified || !signals.phoneNumber) return 'unavailable'

  if (
    signals.smsOptIn === 'opted_in' ||
    signals.emailOptIn === 'opted_in' ||
    signals.pendingEmail !== null
  ) {
    return 'active'
  }

  if (
    signals.smsOptIn === 'opted_out' ||
    signals.reminderPromptDismissedAt !== null ||
    signals.reminderInterstitialSeenAt !== null
  ) {
    return 'retired'
  }

  return 'eligible'
}

export function shouldOfferReminderAcquisition(signals: ReminderAcquisitionSignals): boolean {
  return deriveReminderAcquisitionState(signals) === 'eligible'
}
