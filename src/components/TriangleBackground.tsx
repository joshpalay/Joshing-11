import Image from 'next/image';
import type { ReactNode } from 'react';

type TriangleBackgroundProps = {
  children?: ReactNode;
  className?: string;
};

/**
 * Full-bleed triangle-pattern background (the JOSHING brand motif).
 *
 * Renders the design-system triangle artwork as a cover image behind its
 * children. Used on the login screens; reusable on any branded full-screen
 * surface. The image lives at public/images/Variant4.png and is served at
 * /images/Variant4.png.
 */
export default function TriangleBackground({ children, className }: TriangleBackgroundProps) {
  return (
    <div className={`relative min-h-screen w-full overflow-hidden bg-[var(--brand-cream-page)] ${className ?? ''}`}>
      <Image
        src="/images/Variant4.png"
        alt=""
        aria-hidden
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      {children}
    </div>
  );
}
