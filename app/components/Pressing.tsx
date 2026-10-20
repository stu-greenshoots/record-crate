import { useEffect, useState } from 'react'
import { setRunout, useStore } from '../store'
import type { PressKind, Pressing, Rec } from '../types'
import { CheckIcon } from './Icons'

const cache = new Map<number, Pressing | null>()

/** The pressing notes for a release, fetched once and kept (null where there are none). */
export function loadPressing(releaseId: number): Promise<Pressing | null> {
  if (cache.has(releaseId)) return Promise.resolve(cache.get(releaseId)!)
  return fetch(`${import.meta.env.BASE_URL}pressings/${releaseId}.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((p) => {
      cache.set(releaseId, p)
      return p
    })
}

/** The pressing notes for a release, fetched once and kept (offline too, via the worker). */
function usePressing(releaseId: number) {
  const [data, setData] = useState<Pressing | null | undefined>(() => cache.get(releaseId))
  useEffect(() => {
    if (cache.has(releaseId)) {
      setData(cache.get(releaseId))
      return
    }
    let live = true
    setData(undefined)
    loadPressing(releaseId).then((p) => {
      if (live) setData(p)
    })
    return () => {
      live = false
    }
  }, [releaseId])
  return data
}

const FIRSTS: PressKind[] = ['first', 'first-vinyl']

/** The short badge for a record's pressing, where it's one worth shouting about. */
export function pressBadge(rec: Rec) {
  if (rec.press === 'first') return 'First pressing'
  if (rec.press === 'first-vinyl') return 'First vinyl pressing'
  return null
}

const money = (n: number | null, currency: string | null) =>
  n == null ? null : new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP', maximumFractionDigits: 0 }).format(n)

function rarity(have: number | null, want: number | null) {
  if (have == null || want == null) return null
  const n = (x: number) => x.toLocaleString('en-GB')
  const ratio = want / Math.max(1, have)
  const tag = have < 150 ? 'Scarce' : ratio > 0.6 ? 'Sought after' : ratio > 0.3 ? 'In demand' : null
  return { line: `${n(have)} have it on Discogs, ${n(want)} want it`, tag }
}

/** Everything known about this pressing: the verdict, where and how it was made, the runouts. */
export function PressingSection({ rec }: { rec: Rec }) {
  const store = useStore()
  const p = usePressing(rec.releaseId)
  const [allNotes, setAllNotes] = useState(false)
  if (p === undefined) return <p className="pressing-loading">Looking up this pressing…</p>
  if (!p) return null

  const v = p.verdict
  const mine = store?.local.runoutOf?.[rec.id]
  const rare = rarity(p.have, p.want)
  const val = p.value
  const prices = [
    ['VG', val.vg],
    ['VG+', val.vgPlus],
    ['NM', val.nearMint],
  ].filter(([, n]) => n != null) as [string, number][]
  const notesText = p.notes.map((n) => n.text).join('')
  const longNotes = notesText.length > 360

  return (
    <section className="pressing">
      <h3 className="section-title">About this pressing</h3>

      {v && (
        <div className={`press-verdict ${FIRSTS.includes(v.kind) ? 'first' : ''}`}>
          <p className="press-verdict-text">
            {v.text}
            {v.promo && <span className="press-tag">Promo</span>}
          </p>
          {v.detail && <p className="press-verdict-detail">{v.detail}</p>}
        </div>
      )}

      <dl className="facts">
        {p.released && (
          <>
            <dt>Released</dt>
            <dd>
              {p.released}
              {p.country ? `, ${p.country}` : ''}
            </dd>
          </>
        )}
        {p.labels.length > 0 && (
          <>
            <dt>Label</dt>
            <dd>{p.labels.map((l) => `${l.name} ${l.catno}`.trim()).filter((x, i, a) => a.indexOf(x) === i).join(' · ')}</dd>
          </>
        )}
        {p.versionCount != null && p.versionCount > 1 && (
          <>
            <dt>Versions</dt>
            <dd>One of {p.versionCount} on vinyl</dd>
          </>
        )}
      </dl>

      {p.physical.length > 0 && (
        <ul className="press-facts">
          {p.physical.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      {p.cutters.length > 0 && (
        <ul className="press-cutters">
          {p.cutters.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}

      {p.runouts.length > 0 && (
        <div className="runouts">
          <h4 className="press-sub">In the run-out groove</h4>
          {p.runouts.length > 1 && (
            <p className="press-hint">
              Discogs knows {p.runouts.length} variants. Find the one scratched into your copy and tick it.
            </p>
          )}
          {p.runouts.map((r) => {
            const key = r.variant ?? 0
            const on = mine === key
            return (
              <div key={key} className={`runout ${on ? 'mine' : ''}`}>
                <div className="runout-sides">
                  {r.variant != null && <span className="runout-variant">Variant {r.variant}</span>}
                  {r.sides.map((s, i) => (
                    <div key={i} className="runout-side">
                      <code>{s.value}</code>
                      {s.side && <span>{s.side}</span>}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className={`tick ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  aria-label={on ? 'Not my copy' : 'This is my copy'}
                  onClick={() => setRunout(rec.id, on ? null : key)}
                >
                  <CheckIcon />
                </button>
              </div>
            )
          })}
          {mine != null && <p className="press-hint mine-note">Checked against your copy.</p>}
        </div>
      )}

      {(rare || prices.length > 0) && (
        <div className="press-market">
          {rare && (
            <p>
              {rare.tag && <span className="press-tag">{rare.tag}</span>}
              {rare.line}
            </p>
          )}
          {prices.length > 0 && (
            <p className="press-prices">
              {prices.map(([k, n]) => (
                <span key={k}>
                  <b>{money(n, val.currency)}</b> {k}
                </span>
              ))}
            </p>
          )}
          {val.lowest != null && (
            <p className="press-hint">
              Cheapest for sale now {money(val.lowest, val.currency)}
              {val.forSale ? ` (${val.forSale} listed)` : ''}. Prices as of the last snapshot.
            </p>
          )}
        </div>
      )}

      {p.notes.length > 0 && (
        <div className={`press-notes ${longNotes && !allNotes ? 'clipped' : ''}`}>
          <h4 className="press-sub">Notes</h4>
          <p>
            {p.notes.map((n, i) =>
              n.href ? (
                <a key={i} href={n.href} target="_blank" rel="noreferrer">
                  {n.text}
                </a>
              ) : (
                <span key={i}>{n.text}</span>
              ),
            )}
          </p>
          {longNotes && (
            <button type="button" className="link-btn" onClick={() => setAllNotes(!allNotes)}>
              {allNotes ? 'Less' : 'All the notes'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
