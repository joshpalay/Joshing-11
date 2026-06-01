import type { CSSProperties } from 'react';

type IconProps = {
  size: number;
  color: string;
};

function svgStyle(color: string): CSSProperties {
  return {
    display: 'block',
    stroke: color,
    fill: 'none',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
}

export function LiteraturePoetryIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M3 6h8v12H3z" />
      <path d="M13 6h8v12h-8z" />
      <path d="M11 7l2 2" />
    </svg>
  );
}

export function LiteratureNovelIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <rect x="4" y="5" width="16" height="3" />
      <rect x="4" y="10.5" width="16" height="3" />
      <rect x="4" y="16" width="16" height="3" />
    </svg>
  );
}

export function ClassicalMusicIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M15 4v11.5a2.5 2.5 0 1 1-1-2V8c-2 1-5 1.2-6 3.5" />
      <path d="M15 6c2 0 3-1.2 4-2" />
    </svg>
  );
}

export function OperaIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M4 16V10a8 8 0 0 1 16 0v6" />
      <path d="M6 16c2-2 4-2 6 0s4 2 6 0" />
    </svg>
  );
}

export function HistoryCampaignsIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M12 20s5-5.5 5-9a5 5 0 1 0-10 0c0 3.5 5 9 5 9z" />
      <path d="M4 20c2-1.8 4-2.6 6-2" />
    </svg>
  );
}

export function HistoryGeneralIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M6 8h12" />
      <path d="M8 8v8" />
      <path d="M12 8v8" />
      <path d="M16 8v8" />
      <path d="M5 16h14" />
      <path d="M8 6c1 0 1.2-1 2-1s1 1 2 1" />
    </svg>
  );
}

export function PhilosophyIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M7 18c3-2 5-5 6-10" />
      <path d="M10 11c1.8 0 3-1 3.5-2.5" />
      <path d="M13 15c1.8 0 2.8-1 3.5-2.5" />
    </svg>
  );
}

export function ScienceIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M10 4h4" />
      <path d="M11 4v4l-5 9h12l-5-9V4" />
    </svg>
  );
}

export function LanguageIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M4 6h16v10H9l-5 4V6z" />
    </svg>
  );
}

export function PopCultureIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M12 4l2.3 4.8 5.2.7-3.8 3.7.9 5.2L12 16l-4.6 2.4.9-5.2-3.8-3.7 5.2-.7z" />
    </svg>
  );
}

export function FilmTvIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <rect x="4" y="8" width="16" height="10" />
      <path d="M4 8l4-4" />
      <path d="M10 8l4-4" />
      <path d="M16 8l4-4" />
    </svg>
  );
}

export function SportIcon({ size, color }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={svgStyle(color)}>
      <path d="M8 6h8v3a4 4 0 0 1-8 0V6z" />
      <path d="M6 8H4a2 2 0 0 0 2 2" />
      <path d="M18 8h2a2 2 0 0 1-2 2" />
      <path d="M12 13v3" />
      <path d="M9 18h6" />
    </svg>
  );
}

export function DomainInitialIcon({ size, color, label }: IconProps & { label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="10" stroke={color} fill="none" strokeWidth="1.8" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fontSize="10"
        fill={color}
        fontFamily="var(--font-instrument-sans), sans-serif"
      >
        {label.slice(0, 1).toUpperCase()}
      </text>
    </svg>
  );
}

export const DOMAIN_ICON_COMPONENTS = {
  literature_poetry: LiteraturePoetryIcon,
  literature_novel: LiteratureNovelIcon,
  classical_music: ClassicalMusicIcon,
  opera: OperaIcon,
  history_campaigns: HistoryCampaignsIcon,
  history_general: HistoryGeneralIcon,
  philosophy: PhilosophyIcon,
  science: ScienceIcon,
  language: LanguageIcon,
  pop_culture: PopCultureIcon,
  film_tv: FilmTvIcon,
  sport: SportIcon,
} as const;

export type DomainIconKey = keyof typeof DOMAIN_ICON_COMPONENTS | 'default';
