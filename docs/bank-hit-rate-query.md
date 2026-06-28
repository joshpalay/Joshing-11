# Bank hit-rate — telemetry aggregation

Turns the per-domain `[daily/bank-telemetry]` log lines
(`src/server/daily/generate-questions.ts:2441`) into an actual hit-rate number.
Every `fall_through` is a fresh Sonnet generation pipeline; every `hit` is a
reused bank row at ~zero LLM cost. This is the single metric that tells you how
linear your generation cost is. Pairs with `docs/retrieval-flip-checklist.md`
(turning the pool-refill / carry-forward levers on).

Data source: the `vercel` dataset in Axiom (Vercel log drain). The telemetry
emits one line per domain per daily-queue build, shaped like:

```
[daily/bank-telemetry] {
  domain: 'Bach',
  outcome: 'fall_through',   // 'hit' | 'fall_through'
  tierRequested: 'specialist',
  tierServed: null,
  fallbackUsed: false        // true ⇒ a ±1 tier-ladder pick saved the slot
}
```

> Note: `outcome` drives the headline number and is always reliably extracted.
> The per-domain breakdown extracts the `domain` string; domains containing an
> apostrophe are pretty-printed by Node with double quotes, so the regex below
> matches both quote styles. A handful may still group as blank — fine for
> ranking the worst offenders, not for exact per-domain accounting.

---

## 1. Headline: overall hit-rate

```kql
vercel
| where _time > ago(14d)
| where message startswith "[daily/bank-telemetry]"
| extend outcome = extract("outcome: '([a-z_]+)'", 1, message)
| extend fallbackUsed = extract("fallbackUsed: (true|false)", 1, message)
| summarize
    total=count(),
    hits=countif(outcome=="hit"),
    fallThroughs=countif(outcome=="fall_through"),
    tierLadderSaves=countif(fallbackUsed=="true")
| extend hitRatePct = round(100.0 * hits / total, 1),
         fallThroughPct = round(100.0 * fallThroughs / total, 1)
```

**Baseline (14d window, measured 2026-06-28): 26.8% hit / 73.2% fall-through**
(250 decisions, 67 hits, 183 fall-throughs, 22 saved by the ±1 tier ladder).
~73% of generation slots fire fresh Sonnet — this is the linear cost to attack.

## 2. By difficulty tier (where the misses concentrate)

```kql
vercel
| where _time > ago(14d)
| where message startswith "[daily/bank-telemetry]"
| extend outcome = extract("outcome: '([a-z_]+)'", 1, message)
| extend tierRequested = extract("tierRequested: '([a-z]+)'", 1, message)
| summarize total=count(), hits=countif(outcome=="hit"),
            fallThroughs=countif(outcome=="fall_through") by tierRequested
| extend hitRatePct = round(100.0 * hits / total, 1)
| sort by total desc
```

**Baseline:** specialist 18.7% hit (100/123 fall through) · moderate 31.5% ·
accessible 42.1%. The deeper the tier, the worse the bank covers it — exactly the
thin-but-active domains the retrieval-grounded pool-refill lever is built for.

## 3. Worst fall-through domains (the pool-refill target list)

```kql
vercel
| where _time > ago(14d)
| where message startswith "[daily/bank-telemetry]"
| extend outcome = extract("outcome: '([a-z_]+)'", 1, message)
| extend domain = extract("domain: [\"']([^\\n]+?)[\"'],", 1, message)
| where outcome == "fall_through"
| summarize fallThroughs=count() by domain
| sort by fallThroughs desc
| take 20
```

**Baseline top offenders:** Breaking Bad, Tears of the Kingdom, Bach, Mozart,
Progressive Era American Politics, 20th Century Composers, Beethoven, Virginia
Woolf Novels, Renaissance Florence, T.S. Eliot — all niche/deep domains that
regenerate per user every time.

## 4. Daily trend (watch this move after flipping a lever)

```kql
vercel
| where _time > ago(30d)
| where message startswith "[daily/bank-telemetry]"
| extend outcome = extract("outcome: '([a-z_]+)'", 1, message)
| summarize total=count(), hits=countif(outcome=="hit") by bin(_time, 1d)
| extend hitRatePct = round(100.0 * hits / total, 1)
| sort by _time asc
```

---

## How to use

1. Record the baseline (§1) before changing anything.
2. Flip a lever (`DAILY_TOPUP_CARRYFORWARD_ENABLED`, then
   `RETRIEVAL_GROUNDING_ENABLED` per the flip checklist).
3. Re-run §1 and §4 after a few daily cron cycles. Carry-forward should lift the
   overall rate (fewer regens for returning users); pool-refill should lift the
   specialist tier in §2 specifically and shrink the §3 list.
