'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

// `icon` is a ReactNode (pre-rendered JSX) rather than a LucideIcon
// component reference so that server components can use this client
// component without violating the RSC serialization rule that forbids
// passing functions (lucide icons are forwardRef refs) across the
// server→client boundary as props.
type CommonProps = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  tone?: 'default' | 'destructive';
  // When true the row renders as a non-interactive, dimmed entry with an
  // "Unavailable" pill instead of the chevron — used by the dev-tools route
  // existence check to show a tool whose target page isn't in this build.
  unavailable?: boolean;
};

type LinkProps = CommonProps & { href: string; onClick?: never; disabled?: never };
type ButtonProps = CommonProps & {
  href?: never;
  onClick: () => void;
  disabled?: boolean;
};

export function SettingsRow(props: LinkProps | ButtonProps): ReactNode {
  const tone = props.tone ?? 'default';
  const titleClass = tone === 'destructive' ? 'text-destructive' : '';
  const iconWrap =
    tone === 'destructive'
      ? 'bg-destructive/10 text-destructive'
      : 'bg-muted text-foreground/70';

  const trailing = props.unavailable ? (
    <span className="flex-none rounded-full bg-muted px-2 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      Unavailable
    </span>
  ) : (
    <ChevronRight className="size-5 flex-none text-muted-foreground" />
  );

  const body = (
    <>
      <span
        className={`grid size-10 flex-none place-items-center rounded-full ${iconWrap}`}
        aria-hidden="true"
      >
        {props.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`font-serif text-base font-semibold leading-tight ${titleClass}`}>
          {props.title}
        </span>
        <span className="mt-0.5 text-sm text-muted-foreground">{props.subtitle}</span>
      </span>
      {trailing}
    </>
  );

  const rowClass =
    'flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60';

  // Unavailable rows never navigate or fire their handler — render an inert,
  // dimmed entry regardless of whether href or onClick was supplied.
  if (props.unavailable) {
    return (
      <div
        className="flex w-full items-center gap-4 px-4 py-4 text-left opacity-50"
        aria-disabled="true"
        title="This tool's route isn't available in this build."
      >
        {body}
      </div>
    );
  }

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
    <div className="divide-y rounded-[var(--radius-card)] border bg-card text-card-foreground shadow-[var(--shadow-card)]">
      {children}
    </div>
  );
}
