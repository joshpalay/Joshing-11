import { CREAM, FS, HILITE, INK } from '@/components/lately/tokens';
import { Skeleton } from '@/components/ui/Skeleton';

// Route-level fallback for /activities ("Lately"). Mirrors the page shell —
// cream canvas, the italic "Lately." headline, then a few quiet one-line
// placeholders — so the frame holds while buildActivityStream resolves.
export default function Loading() {
  return (
    <main style={{ background: CREAM, color: INK, minHeight: '100dvh' }}>
      <div
        style={{
          maxWidth: 420,
          margin: '0 auto',
          padding: '18px 20px 100px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <h1
            style={{
              fontSize: 46,
              fontFamily: FS,
              fontWeight: 400,
              fontStyle: 'italic',
              lineHeight: 1,
              margin: 0,
              letterSpacing: -1.5,
              position: 'relative',
              display: 'inline-block',
            }}
          >
            Lately.
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: '30%',
                bottom: 4,
                height: 8,
                background: HILITE,
                zIndex: -1,
                opacity: 0.85,
              }}
            />
          </h1>
        </div>

        <div
          aria-hidden="true"
          style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              style={{
                height: 16,
                width: `${85 - i * 6}%`,
                borderRadius: 4,
              }}
            />
          ))}
        </div>

        <span className="sr-only" role="status">
          Loading what&rsquo;s happening…
        </span>
      </div>
    </main>
  );
}
