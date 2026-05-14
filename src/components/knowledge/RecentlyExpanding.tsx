'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

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

const SESSION_KEY = 'joshing-recently-expanding-open';

export function RecentlyExpanding({ domains, playerDisplayName = 'Josh', onNotice }: RecentlyExpandingProps) {
  const [expanded, setExpanded] = useState(() => (
    typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_KEY) === 'true'
  ));

  useEffect(() => {
    window.sessionStorage.setItem(SESSION_KEY, expanded ? 'true' : 'false');
  }, [expanded]);

  const visibleDomains = expanded ? domains.slice(0, 8) : domains.slice(0, 2);
  const canExpand = domains.length > 2;
  const shareSummary = useMemo(() => buildShareText(playerDisplayName, visibleDomains), [playerDisplayName, visibleDomains]);

  const toggleExpanded = () => {
    if (canExpand) setExpanded((current) => !current);
  };

  return (
    <section style={boxStyle} aria-label="Recently Expanding">
      <style>{`
        @keyframes recentExpansionIn {
          to { opacity: 1; transform: translateY(0); }
        }
        @media (hover: hover) {
          button[aria-label^=\"Share \"], button[aria-label^=\"Copy \"] { transition: color 160ms ease, background-color 160ms ease; }
          button[aria-label^=\"Share \"]:hover, button[aria-label^=\"Copy \"]:hover { color: #1a1208; background: #f3ede2; }
        }
        @media (max-width: 520px) {
          [data-expanding-actions=\"true\"] { grid-template-columns: repeat(4, 44px); }
        }
      `}</style>
      <div style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Recently Expanding</h2>
          <p style={helperStyle}>Territory that moved recently.</p>
        </div>
      </div>

      {domains.length === 0 ? (
        <div style={emptyWrapStyle}>
          <p style={emptyTitleStyle}>Your world is still taking shape.</p>
          <p style={emptyCopyStyle}>Play a few more rounds and your expanding territory will appear here.</p>
        </div>
      ) : (
        <>
          <div style={rowsStyle}>
            {visibleDomains.map((domain, index) => (
              <ExpandingDomainRow
                key={domain.domain}
                domain={domain}
                index={index}
                maxScore={Math.max(...domains.map((entry) => entry.momentumScore), 1)}
                shareText={buildShareText(playerDisplayName, [domain])}
                onNotice={onNotice}
              />
            ))}
          </div>
          <button
            type="button"
            style={canExpand ? footerButtonStyle : disabledFooterStyle}
            onClick={toggleExpanded}
            disabled={!canExpand}
            aria-expanded={expanded}
          >
            <span>{canExpand ? (expanded ? 'Show less' : 'Show more') : shareSummary}</span>
            {canExpand ? <span style={chevronStyle}>{expanded ? '⌃' : '⌄'}</span> : null}
          </button>
        </>
      )}
    </section>
  );
}

type RowProps = {
  domain: ExpandingDomain;
  index: number;
  maxScore: number;
  shareText: string;
  onNotice?: (message: string) => void;
};

function ExpandingDomainRow({ domain, index, maxScore, shareText, onNotice }: RowProps) {
  const fill = Math.max(0.18, Math.min(1, domain.momentumScore / maxScore));
  const share = (target: 'text' | 'facebook' | 'x' | 'instagram') => {
    void shareDomain(target, shareText, onNotice);
  };

  return (
    <div style={{ ...rowStyle, animationDelay: `${Math.min(index * 26, 160)}ms` }}>
      <div style={{ ...momentumStyle, background: `conic-gradient(#1a1208 ${fill * 360}deg, #ede7dc 0deg)` }} aria-hidden="true">
        <span style={momentumInnerStyle} />
      </div>
      <div style={rowTextStyle}>
        <h3 style={domainNameStyle}>{domain.domain}</h3>
        {domain.supportingText ? <p style={supportingStyle}>{domain.supportingText}</p> : null}
      </div>
      <div style={shareActionsStyle} data-expanding-actions="true" aria-label={`Share ${domain.domain}`}>
        <button type="button" style={shareButtonStyle} onClick={() => share('text')} aria-label={`Share ${domain.domain} by text`}>✉</button>
        <button type="button" style={shareButtonStyle} onClick={() => share('facebook')} aria-label={`Share ${domain.domain} to Facebook`}>f</button>
        <button type="button" style={shareButtonStyle} onClick={() => share('x')} aria-label={`Share ${domain.domain} to X`}>𝕏</button>
        <button type="button" style={shareButtonStyle} onClick={() => share('instagram')} aria-label={`Copy ${domain.domain} for an Instagram story`}>◎</button>
      </div>
    </div>
  );
}

function buildShareText(playerDisplayName: string, domains: Pick<ExpandingDomain, 'domain'>[]): string {
  const names = domains.map((domain) => domain.domain).filter(Boolean).slice(0, 3);
  const owner = playerDisplayName.trim().toLowerCase() === 'you' ? 'Your' : `${playerDisplayName}'s`;
  if (names.length === 0) return `${owner} world is still taking shape on Joshing.`;
  return `${owner} world has been expanding into:\n${names.join('\n')}`;
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
  onNotice?.(target === 'instagram' ? 'Story text copied.' : 'Share text copied.');
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
  border: '1px solid #ddd6c7',
  padding: '0.95rem',
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
  fontWeight: 600,
};

const helperStyle: CSSProperties = {
  margin: '0.15rem 0 0',
  color: '#8a8070',
  fontSize: '0.72rem',
};

const rowsStyle: CSSProperties = {
  display: 'grid',
  gap: '0.35rem',
};

const rowStyle: CSSProperties = {
  minHeight: 58,
  display: 'grid',
  gridTemplateColumns: '32px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '0.65rem',
  padding: '0.38rem 0',
  opacity: 0,
  transform: 'translateY(6px)',
  animation: 'recentExpansionIn 220ms ease-out forwards',
};

const momentumStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
};

const momentumInnerStyle: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 999,
  background: '#fffdf8',
  border: '1px solid #e8e2d6',
};

const rowTextStyle: CSSProperties = {
  minWidth: 0,
};

const domainNameStyle: CSSProperties = {
  margin: 0,
  color: '#1a1208',
  fontSize: '0.94rem',
  fontWeight: 600,
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
};

const supportingStyle: CSSProperties = {
  margin: '0.18rem 0 0',
  color: '#696257',
  fontSize: '0.76rem',
  lineHeight: 1.25,
};

const shareActionsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 44px)',
  justifyContent: 'end',
  opacity: 0.72,
};

const shareButtonStyle: CSSProperties = {
  width: 44,
  height: 44,
  border: 0,
  borderRadius: 999,
  background: 'transparent',
  color: '#8a8070',
  fontSize: 16,
  cursor: 'pointer',
};

const footerButtonStyle: CSSProperties = {
  minHeight: 44,
  width: '100%',
  border: 0,
  borderTop: '1px solid #eee6d9',
  background: 'transparent',
  color: '#696257',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.35rem',
  fontSize: '0.78rem',
  cursor: 'pointer',
};

const disabledFooterStyle: CSSProperties = {
  ...footerButtonStyle,
  cursor: 'default',
  color: '#8a8070',
};

const chevronStyle: CSSProperties = {
  color: '#8a8070',
  fontSize: '1rem',
  lineHeight: 1,
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
