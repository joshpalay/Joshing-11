'use client';

import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type SwitchProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Accessible name for the toggle (required — switches have no visible text). */
  label: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'aria-checked' | 'role' | 'type'>;

/**
 * The app's single toggle switch. Replaces the duplicated `role="switch"`
 * markup that lived in NotificationsForm and PrivacyForm (which also used a raw
 * `bg-emerald-500` on-state). On-state uses the brand `--primary` (navy);
 * adds the keyboard `focus-visible` ring those hand-rolled toggles lacked.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  className,
  disabled,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block size-5 transform rounded-full bg-[var(--brand-card)] shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
