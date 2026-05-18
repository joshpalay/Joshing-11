'use client';

import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type CommonProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  tone?: 'default' | 'destructive';
};

type LinkProps = CommonProps & { href: string; onClick?: never; disabled?: never };
type ButtonProps = CommonProps & {
  href?: never;
  onClick: () => void;
  disabled?: boolean;
};

export function SettingsRow(props: LinkProps | ButtonProps): ReactNode {
  const Icon = props.icon;
  const tone = props.tone ?? 'default';
  const titleClass = tone === 'destructive' ? 'text-destructive' : '';
  const iconWrap =
    tone === 'destructive'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-muted text-foreground/70';

  const body = (
    <>
      <span
        className={`grid size-10 flex-none place-items-center rounded-full ${iconWrap}`}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`font-serif text-base font-semibold leading-tight ${titleClass}`}>
          {props.title}
        </span>
        <span className="mt-0.5 text-sm text-muted-foreground">{props.subtitle}</span>
      </span>
      <ChevronRight className="size-5 flex-none text-muted-foreground" />
    </>
  );

  const rowClass =
    'flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60';

  if ('href' in props && props.href) {
    return (
      <Link href={props.href} className={rowClass}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" className={rowClass} onClick={props.onClick} disabled={props.disabled}>
      {body}
    </button>
  );
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y rounded-xl border bg-card text-card-foreground shadow-sm">
      {children}
    </div>
  );
}
