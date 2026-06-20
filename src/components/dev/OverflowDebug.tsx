'use client'

import { useEffect, useState } from 'react'

// TEMPORARY DIAGNOSTIC. Renders a fixed overlay listing the elements whose right
// edge extends past the viewport — i.e. whatever is causing the home page to be
// wider than the screen on iOS. Remove once the culprit is found.
export function OverflowDebug() {
  const [lines, setLines] = useState<string>('measuring…')

  useEffect(() => {
    const run = () => {
      const vw = document.documentElement.clientWidth
      const sw = document.documentElement.scrollWidth
      const hits: { right: number; width: number; desc: string }[] = []
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return
        if (r.right > vw + 0.5) {
          const cls =
            typeof el.className === 'string' ? el.className.replace(/\s+/g, '.').slice(0, 34) : ''
          hits.push({
            right: Math.round(r.right),
            width: Math.round(r.width),
            desc: `${el.tagName.toLowerCase()}.${cls}`,
          })
        }
      })
      hits.sort((a, b) => b.right - a.right)
      const top = hits
        .slice(0, 8)
        .map((h) => `R${h.right} w${h.width} ${h.desc}`)
        .join('\n')
      setLines(`vw=${vw} sw=${sw} overflow=${sw > vw ? sw - vw : 0}px  (${hits.length} past edge)\n${top}`)
    }
    run()
    const t = window.setTimeout(run, 1200)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.88)',
        color: '#39ff14',
        font: '11px/1.35 ui-monospace,Menlo,monospace',
        padding: '6px 8px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        pointerEvents: 'none',
      }}
    >
      {lines}
    </div>
  )
}
