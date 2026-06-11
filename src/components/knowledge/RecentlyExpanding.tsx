'use client';

import { useMemo, type CSSProperties } from 'react';
import { Share2 } from 'lucide-react';

export type ExpandingDomain = {
  domain: string;
  momentumScore: number;
  reason:
    | 'new-discovery'
    | 'mastery-shift'
    | 'social-overlap'
    | 'saved-questions'
    | 'active-play';
  supportingText?: string;
};

type RecentlyExpandingProps = {
  domains: ExpandingDomain[];
  playerDisplayName?: string;
  onNotice?: (message: string) => void;
};

const MAX_EXPANDING_DOMAINS = 5;
const ROW_ACCENTS = [
  { border: '#c9564d', fill: 'rgba(201, 86, 77, 0.16)', text: '#9b3f37' },
  { border: '#a98a4c', fill: 'rgba(169, 138, 76, 0.14)', text: '#7c6332' },
  { border: '#c9564d', fill: 'rgba(201, 86, 77, 0.16)', text: '#9b3f37' },
  { border: '#65a8bb', fill: 'rgba(101, 168, 187, 0.20)', text: '#2f7487' },
  { border: '#a98a4c', fill: 'rgba(169, 138, 76, 0.14)', text: '#7c6332' },
];

export function RecentlyExpanding({ domains, playerDisplayName = 'Josh', onNotice }: RecentlyExpandingProps) {
  const visibleDomains = domains.slice(0, MAX_EXPANDING_DOMAINS);
  const shareSummary = useMemo(() => buildShareText(playerDisplayName, visibleDomains), [playerDisplayName, visibleDomains]);

  const shareAll = () => {
    void shareDomain('text', shareSummary, onNotice);
  };

  return (
    <section style={boxStyle} aria-label="Recently Expanding">
      <style>{`
        @keyframes recentExpansionIn {
          to { opacity: 1; transform: translateY(0); }
        }
        [data-expanding-row="true"] { grid-template-columns: 44px minmax(0, 1fr); }
        @media (hover: hover) {
          button[data-expanding-share="true"] { transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease; }
          button[data-expanding-share="true"]:hover { border-color: #c9bea9; background: #f8f3eb; transform: translateY(-1px); }
        }
      `}</style>
      <p style={wordmarkStyle}>Joshing</p>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Recently Expanding</h2>
        {visibleDomains.length > 0 ? (
          <button
            type="button"
            style={shareButtonStyle}
            onClick={shareAll}
            data-expanding-share="true"
            aria-label="Share recently expanding territories"
          >
            <Share2 size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Share</span>
          </button>
        ) : null}
      </div>

      {domains.length === 0 ? (
        <div style={emptyWrapStyle}>
          <p style={emptyTitleStyle}>Your world is still taking shape.</p>
          <p style={emptyCopyStyle}>Play a few more rounds and your expanding territory will appear here.</p>
        </div>
      ) : (
        <div style={rowsStyle}>
          {visibleDomains.map((domain, index) => (
            <ExpandingDomainRow
              key={domain.domain}
              domain={domain}
              index={index}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type RowProps = {
  domain: ExpandingDomain;
  index: number;
};

function ExpandingDomainRow({ domain, index }: RowProps) {
  const accent = ROW_ACCENTS[index % ROW_ACCENTS.length];
  const activity = getRowActivity(domain);
  const initial = getDomainInitial(domain.domain);

  return (
    <div style={{ ...rowStyle, animationDelay: `${Math.min(index * 34, 170)}ms` }} data-expanding-row="true">
      <div
        style={{ ...badgeStyle, borderColor: accent.border, background: accent.fill }}
        aria-hidden="true"
      >
        {initial}
      </div>
      <div style={rowTextStyle}>
        <h3 style={domainNameStyle}>{domain.domain}</h3>
        {activity ? <p style={supportingStyle}>{activity}</p> : null}
      </div>
    </div>
  );
}

function getDomainInitial(domain: string): string {
  const firstMeaningfulWord = domain
    .replace(/&/g, ' ')
    .split(/\s+/)
    .find((word) => /^[a-z0-9]/i.test(word));
  return (firstMeaningfulWord?.[0] ?? domain[0] ?? '?').toUpperCase();
}

/**
 * Returns the row's supporting line. Prefers the real `supportingText` plumbed
 * in by the caller; otherwise falls back to a qualitative label derived from the
 * real `reason` enum. Deliberately carries NO invented numbers or tier
 * transitions — earlier versions fabricated "+2 levels this week" / "Biggest
 * jump this week" keyed off the array index, which is not real user data.
 */
function getRowActivity(domain: ExpandingDomain): string {
  if (domain.supportingText && !/territory moved recently/i.test(domain.supportingText)) {
    return domain.supportingText;
  }

  switch (domain.reason) {
    case 'new-discovery':
      return 'New territory';
    case 'social-overlap':
      return 'People answered yours';
    case 'saved-questions':
      return 'New questions explored';
    case 'mastery-shift':
      return 'Leveling up';
    case 'active-play':
    default:
      return 'Revisited and growing';
  }
}

function buildShareText(playerDisplayName: string, domains: Pick<ExpandingDomain, 'domain'>[]): string {
  const names = domains.map((domain) => domain.domain).filter(Boolean).slice(0, MAX_EXPANDING_DOMAINS);
  const owner = playerDisplayName.trim().toLowerCase() === 'you' ? 'Your' : `${playerDisplayName}'s`;
  if (names.length === 0) return `${owner} world is still taking shape on Joshing.`;
  return `${owner} knowledge is growing in these territories:\n${names.map((name, index) => `${index + 1}. ${name}`).join('\n')}`;
}

async function shareDomain(target: 'text' | 'facebook' | 'x' | 'instagram', text: string, onNotice?: (message: string) => void) {
  const url = typeof window !== 'undefined' ? window.location.origin + '/knowledge' : 'https://joshing.app/knowledge';
  if (target === 'text' && navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch {
      // User cancellation should fall back to copy without surfacing an error.
    }
  }

  if (target === 'facebook') {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    return;
  }

  if (target === 'x') {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener,noreferrer');
    return;
  }

  await copyShareText(`${text}\n${url}`);
  onNotice?.(target === 'instagram' ? 'Story text copied.' : 'Recently expanding territories copied.');
}

async function copyShareText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

const boxStyle: CSSProperties = {
  background: 'var(--brand-cream-card)',
  border: '1px solid var(--brand-border)',
  borderRadius: 12,
  boxShadow: '0 4px 12px rgba(40, 32, 30, 0.04)',
  padding: '1.05rem 0.95rem 0.65rem',
  display: 'grid',
  gap: '0.75rem',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
};

const wordmarkStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans-body), system-ui, sans-serif',
  fontWeight: 700,
  fontSize: '0.92rem',
  color: 'var(--brand-ink)',
  letterSpacing: '0.01em',
  lineHeight: 1,
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--brand-ink)',
  fontFamily: 'var(--font-sans-body), system-ui, sans-serif',
  fontSize: '0.8rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

const shareButtonStyle: CSSProperties = {
  minHeight: 38,
  padding: '0 0.82rem',
  border: '1px solid var(--warm-border-soft)',
  borderRadius: 999,
  background: '#fffdf8',
  color: 'var(--warm-ink)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.35rem',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const rowsStyle: CSSProperties = {
  display: 'grid',
};

const rowStyle: CSSProperties = {
  minHeight: 62,
  display: 'grid',
  alignItems: 'center',
  columnGap: '0.75rem',
  padding: '0.54rem 0',
  borderTop: '1px solid #eee8dd',
  opacity: 0,
  transform: 'translateY(6px)',
  animation: 'recentExpansionIn 220ms ease-out forwards',
};

const badgeStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: '1px solid',
  color: 'var(--warm-ink)',
  display: 'grid',
  placeItems: 'center',
  fontSize: '0.86rem',
  fontWeight: 700,
  lineHeight: 1,
};

const rowTextStyle: CSSProperties = {
  minWidth: 0,
};

const domainNameStyle: CSSProperties = {
  margin: 0,
  color: 'var(--warm-ink)',
  fontFamily: 'var(--font-serif), Georgia, serif',
  fontSize: '0.92rem',
  fontWeight: 700,
  lineHeight: 1.18,
  overflowWrap: 'anywhere',
};

const supportingStyle: CSSProperties = {
  margin: '0.18rem 0 0',
  color: 'var(--warm-ink-700)',
  fontSize: '0.68rem',
  lineHeight: 1.25,
};

const emptyWrapStyle: CSSProperties = {
  borderTop: '1px solid #eee6d9',
  paddingTop: '0.75rem',
};

const emptyTitleStyle: CSSProperties = {
  margin: 0,
  color: 'var(--warm-ink)',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const emptyCopyStyle: CSSProperties = {
  margin: '0.3rem 0 0',
  color: 'var(--warm-ink-700)',
  fontSize: '0.82rem',
  lineHeight: 1.35,
};
