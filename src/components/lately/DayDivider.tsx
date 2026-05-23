import { FM, INK3, RULE } from './tokens';

export function DayDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        margin: '28px 0 18px',
      }}
    >
      <div style={{ flex: 1, height: 1, background: RULE }} />
      <div
        style={{
          fontSize: 10,
          fontFamily: FM,
          color: INK3,
          letterSpacing: 3,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: RULE }} />
    </div>
  );
}
