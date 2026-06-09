import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

// The shared shell for every left-aligned card in the play thread — question,
// result, answer-reveal, reflection, and knowledge cards all render through this
// so the thread reads as one conversation surface instead of several mini
// design systems. One radius / border / padding / spacing family; card types
// vary only by accent color and the content hierarchy inside.
//
// Width is owned by the row wrapper (`--play-thread-card-width`), so the shell
// fills its column (`width: 100%`) and never defines a one-off width of its own.
export const THREAD_CARD_RADIUS = 'var(--radius-md)';
export const THREAD_CARD_PADDING = '14px 16px';

export type ThreadCardProps = {
  /**
   * Optional 3px left rail color — the established "verdict tone" device on
   * result cards (green correct, terracotta wrong). Omit for plain cards.
   */
  rail?: string;
  /** Border color. Defaults to the neutral page rule. */
  border?: string;
  /** Background fill. Defaults to the standard content-card surface. */
  fill?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'children'>;

export function ThreadCard({
  rail,
  border = 'var(--brand-rule)',
  fill = 'var(--brand-card)',
  style,
  children,
  ...rest
}: ThreadCardProps) {
  return (
    <div
      {...rest}
      style={{
        width: '100%',
        borderRadius: THREAD_CARD_RADIUS,
        border: `1px solid ${border}`,
        ...(rail ? { borderLeft: `3px solid ${rail}` } : null),
        background: fill,
        padding: THREAD_CARD_PADDING,
        color: 'var(--text)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
