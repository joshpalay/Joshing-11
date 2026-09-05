import Link from 'next/link'

import { formatUsPhoneInput } from '@/lib/phone-e164'

export function SmsReminderDisclosure({
  phoneNumber,
  actionLabel,
  className = 'text-muted-foreground text-xs leading-5',
}: {
  phoneNumber?: string | null
  actionLabel: string
  className?: string
}) {
  const formattedPhone = phoneNumber ? formatUsPhoneInput(phoneNumber) : ''

  return (
    <p className={className}>
      By choosing {actionLabel}, you agree to receive automated Joshing reminder texts at{' '}
      {formattedPhone || 'your account phone number'}, up to one message per day. Message and data
      rates may apply. Reply <strong>STOP</strong> to unsubscribe or <strong>HELP</strong> for help.
      Consent is not a condition of purchase.{' '}
      <Link href="/terms" className="font-medium underline underline-offset-2">
        Terms
      </Link>{' '}
      and{' '}
      <Link href="/privacy" className="font-medium underline underline-offset-2">
        Privacy
      </Link>
      .
    </p>
  )
}
