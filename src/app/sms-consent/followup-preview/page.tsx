'use client'

import { ReminderInterstitial } from '@/app/daily/summary/ReminderInterstitial'

export default function DailySummarySmsReminderPreview() {
  return (
    <ReminderInterstitial
      preview
      phoneNumber="+12025550147"
      onProceed={() => undefined}
    />
  )
}
