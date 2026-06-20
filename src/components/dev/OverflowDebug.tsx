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
      const body = document.body
      const main = document.querySelector('main')
      const fmt = (el: Element | null) => {
        if (!el) return 'null'
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return `L${Math.round(r.left)} R${Math.round(r.right)} w${Math.round(r.width)} | mL${cs.marginLeft} mR${cs.marginRight} pL${cs.paddingLeft} pR${cs.paddingRight} maxW${cs.maxWidth}`
      }
      // the today card = first elevated card inside main
      const card = main?.querySelector('div[class*="feed-card-elevated"]') ?? main?.children[1] ?? null
      setLines(
        `vw=${vw} sw=${sw} over=${sw - vw}\n` +
          `BODY ${fmt(body)}\n` +
          `MAIN ${fmt(main)}\n` +
          `CARD ${fmt(card)}`,
      )
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
