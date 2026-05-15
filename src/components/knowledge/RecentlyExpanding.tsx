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
        [data-expanding-row="true"] { grid-template-columns: 44px minmax(0, 1fr) minmax(112px, auto) minmax(86px, 112px); }
        @media (hover: hover) {
          button[data-expanding-share="true"] { transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease; }
          button[data-expanding-share="true"]:hover { border-color: #c9bea9; background: #f8f3eb; transform: translateY(-1px); }
        }
        @media (max-width: 560px) {
          [data-expanding-row="true"] { grid-template-columns: 44px minmax(0, 1fr); }
          [data-expanding-growth="true"] { grid-column: 2; justify-self: start; text-align: left; }
          [data-expanding-proof="true"] { grid-column: 2; border-left: 0; padding-left: 0; justify-self: start; text-align: left; }
        }
      `}</style>
      <div style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Recently Expanding</h2>
          <p style={helperStyle}>Territories where your knowledge is growing.</p>
        </div>
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
  const rowContent = getRowContent(domain, index);
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
        <p style={supportingStyle}>{rowContent.activity}</p>
      </div>
      <p style={{ ...growthStyle, color: accent.text }} data-expanding-growth="true">
        <span>{rowContent.from}</span>
        <span style={arrowStyle}>→</span>
        <span>{rowContent.to}</span>
      </p>
      <p style={proofStyle} data-expanding-proof="true">{rowContent.proof}</p>
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

function getRowContent(domain: ExpandingDomain, index: number): {
  activity: string;
  from: string;
  to: string;
  proof: string;
} {
  if (domain.supportingText && !/territory moved recently/i.test(domain.supportingText)) {
    return {
      ...growthFor(domain.reason, index),
      activity: domain.supportingText,
    };
  }

  switch (domain.reason) {
    case 'new-discovery':
      return { activity: '+1 new territory this week', from: 'Establishing', to: 'Familiar', proof: '1 discovery this week' };
    case 'social-overlap':
      return { activity: 'People answered yours', from: 'Establishing', to: 'Familiar', proof: '2 people answered yours' };
    case 'saved-questions':
      return { activity: 'New questions explored', from: 'Establishing', to: 'Familiar', proof: '2 saved questions' };
    case 'mastery-shift':
      return { activity: '+2 levels this week', from: 'Familiar', to: 'Solid', proof: index === 2 ? 'Biggest jump this week' : '3 discoveries this week' };
    case 'active-play':
    default:
      return { activity: 'Revisited and growing', from: 'Familiar', to: 'Solid', proof: 'Fastest growth' };
  }
}

function growthFor(reason: ExpandingDomain['reason'], index: number): { from: string; to: string; proof: string } {
  switch (reason) {
    case 'new-discovery':
      return { from: 'Establishing', to: 'Familiar', proof: '1 discovery this week' };
    case 'social-overlap':
      return { from: 'Establishing', to: 'Familiar', proof: '2 people answered yours' };
    case 'saved-questions':
      return { from: 'Establishing', to: 'Familiar', proof: '2 saved questions' };
    case 'mastery-shift':
      return { from: 'Familiar', to: 'Solid', proof: index === 2 ? 'Biggest jump this week' : '3 discoveries this week' };
    case 'active-play':
    default:
      return { from: 'Familiar', to: 'Solid', proof: 'Fastest growth' };
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
  background: '#fffdf8',
  border: '1px solid #eee7dc',
  borderRadius: 14,
  boxShadow: '0 1px 8px rgba(26, 18, 8, 0.04)',
  padding: '1.05rem 0.95rem 0.65rem',
  display: 'grid',
  gap: '0.75rem',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.75rem',
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: '#1a1208',
  fontFamily: 'var(--font-literata), Georgia, serif',
  fontSize: '1rem',
  fontWeight: 700,
};

const helperStyle: CSSProperties = {
  margin: '0.15rem 0 0',
  color: '#696257',
  fontSize: '0.74rem',
  lineHeight: 1.35,
  maxWidth: 230,
};

const shareButtonStyle: CSSProperties = {
  minHeight: 38,
  padding: '0 0.82rem',
  border: '1px solid #ddd6c7',
  borderRadius: 999,
  background: '#fffdf8',
  color: '#1a1208',
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
  color: '#1a1208',
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
  color: '#1a1208',
  fontFamily: 'var(--font-literata), Georgia, serif',
  fontSize: '0.8rem',
  fontWeight: 700,
  lineHeight: 1.18,
  overflowWrap: 'anywhere',
};

const supportingStyle: CSSProperties = {
  margin: '0.18rem 0 0',
  color: '#696257',
  fontSize: '0.68rem',
  lineHeight: 1.25,
};

const growthStyle: CSSProperties = {
  margin: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.2rem',
  fontSize: '0.66rem',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const arrowStyle: CSSProperties = {
  color: '#8a8070',
  fontWeight: 500,
};

const proofStyle: CSSProperties = {
  margin: 0,
  minHeight: 34,
  borderLeft: '1px solid #f0e8dc',
  paddingLeft: '0.75rem',
  color: '#403a33',
  fontSize: '0.66rem',
  lineHeight: 1.35,
};

const emptyWrapStyle: CSSProperties = {
  borderTop: '1px solid #eee6d9',
  paddingTop: '0.75rem',
};

const emptyTitleStyle: CSSProperties = {
  margin: 0,
  color: '#1a1208',
  fontSize: '0.92rem',
  fontWeight: 600,
};

const emptyCopyStyle: CSSProperties = {
  margin: '0.3rem 0 0',
  color: '#696257',
  fontSize: '0.82rem',
  lineHeight: 1.35,
};
