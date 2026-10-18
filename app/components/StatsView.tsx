import { useMemo, type ReactNode } from 'react'
import { EMPTY_FILTER } from '../../shared/filter.js'
import { ENG, PLAY, PROD } from '../../shared/credits.js'
import { unitFilter, type Filter } from '../filter'
import { useStore, type Derived } from '../store'
import { go } from '../route'
import { yearOf } from '../where'
import type { Rec } from '../types'
import { Sleeve } from './Sleeve'

type Row = { key: string; label: ReactNode; n: number; sub?: string; filter?: Partial<Filter>; to?: string }

const money = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n)

function tally<T>(records: Rec[], f: (r: Rec) => T | T[] | null | undefined) {
  const m = new Map<T, number>()
  for (const r of records) {
    const v = f(r)
    for (const k of Array.isArray(v) ? v : v == null ? [] : [v]) m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m].sort((a, b) => b[1] - a[1])
}

/** Light up a choice on the unit. */
function show(store: Derived, f: Partial<Filter>) {
  unitFilter.set({ ...(EMPTY_FILTER as Filter), ...f }, store.snapshot.exportedAt)
  go('unit')
}

/** The collection by numbers. Most rows open the unit with those records lit. */
export function StatsView() {
  const store = useStore()
  const s = useMemo(() => (store ? compute(store) : null), [store])
  if (!store || !s) return null

  return (
    <div className="page stats-page">
      <h1 className="page-title">The collection</h1>
      <div className="stat-tiles">
        <Tile n={s.records} label="records" />
        <Tile n={s.artists} label="artists" />
        <Tile n={s.firsts} label="first pressings" />
        {s.value > 0 && <Tile n={money(s.value)} label={`at VG+ (${s.priced} priced)`} />}
      </div>

      <Section title="When it was made">
        <Bars store={store} rows={s.decades} />
      </Section>
      <Section title="Genres">
        <Bars store={store} rows={s.genres} />
      </Section>
      <Section title="Styles">
        <Bars store={store} rows={s.styles} />
      </Section>
      <Section title="Labels">
        <Bars store={store} rows={s.labels} />
      </Section>
      <Section title="Most on the shelf">
        <Bars store={store} rows={s.topArtists} />
      </Section>
      <Section title="Players">
        <Bars store={store} rows={s.players} />
      </Section>
      <Section title="Engineers">
        <Bars store={store} rows={s.engineers} />
      </Section>
      <Section title="Producers">
        <Bars store={store} rows={s.producers} />
      </Section>
      <Section title="Pressings">
        <Bars store={store} rows={s.verdicts} />
      </Section>
      <Section title="Where they were pressed">
        <Bars store={store} rows={s.countries} />
      </Section>
      <Section title="Pressing plants">
        <Bars store={store} rows={s.plants} />
      </Section>
      {s.complete.length > 0 && (
        <Section title="Complete, or nearly">
          <Bars store={store} rows={s.complete} plain />
        </Section>
      )}
      <Section title="Rarest" note="Fewest copies in Discogs collections">
        <Records list={s.rarest} sub={(r) => `${r.have?.toLocaleString('en-GB')} have it`} />
      </Section>
      <Section title="Most wanted" note="Most wants for every copy owned">
        <Records list={s.wanted} sub={(r) => `${r.want?.toLocaleString('en-GB')} want, ${r.have?.toLocaleString('en-GB')} have`} />
      </Section>
      {s.valuable.length > 0 && (
        <Section title="Most valuable" note="Suggested price at VG+">
          <Records list={s.valuable} sub={(r) => money(r.value!)} />
        </Section>
      )}
      <Section title="Oldest and newest">
        <Records list={s.ends} sub={(r) => String(yearOf(r) || '')} />
      </Section>
      <Section title="Added each year">
        <Bars store={store} rows={s.added} />
      </Section>
    </div>
  )
}

function Tile({ n, label }: { n: number | string; label: string }) {
  return (
    <div className="stat-tile">
      <b>{typeof n === 'number' ? n.toLocaleString('en-GB') : n}</b>
      <span>{label}</span>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="stat-section">
      <h3 className="section-title">{title}</h3>
      {note && <p className="stat-note">{note}</p>}
      {children}
    </section>
  )
}

function Bars({ store, rows, plain = false }: { store: Derived; rows: Row[]; plain?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <ul className="stat-bars">
      {rows.map((r) => {
        const tap = r.filter ? () => show(store, r.filter!) : r.to ? () => go(r.to!) : undefined
        const body = (
          <>
            <span className="stat-label">
              {r.label}
              {r.sub && <small>{r.sub}</small>}
            </span>
            <span className="stat-n">{r.n}</span>
            {!plain && <span className="stat-bar" style={{ width: `${(r.n / max) * 100}%` }} />}
          </>
        )
        return (
          <li key={r.key}>
            {tap ? (
              <button type="button" className="stat-row" onClick={tap}>
                {body}
              </button>
            ) : (
              <div className="stat-row">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Records({ list, sub }: { list: Rec[]; sub: (r: Rec) => string }) {
  return (
    <ul className="results">
      {list.map((r) => (
        <li key={r.id}>
          <button type="button" className="result" onClick={() => go(`r/${r.id}`)}>
            <Sleeve rec={r} className="result-sleeve" />
            <span className="result-text">
              <span className="result-title">{r.title}</span>
              <span className="result-artist">{r.artist}</span>
            </span>
            <span className="stat-side">{sub(r)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const VERDICTS: Record<string, string> = {
  first: 'First pressings',
  'same-year': 'Same year, not the first',
  'first-local': 'First in their country',
  'first-vinyl': 'First vinyl pressings',
  reissue: 'Reissues',
  repress: 'Represses',
  unofficial: 'Unofficial',
  unknown: 'Not known',
}

function compute(store: Derived) {
  const recs = store.records
  const people = store.snapshot.people || []
  const top = (rows: [string, number][], n: number, filter?: (k: string) => Partial<Filter>): Row[] =>
    rows.slice(0, n).map(([k, c]) => ({ key: k, label: k, n: c, filter: filter?.(k) }))

  const decades = tally(recs, (r) => {
    const y = yearOf(r)
    return y ? Math.floor(y / 10) * 10 : null
  })
    .sort((a, b) => a[0] - b[0])
    .map(([d, n]) => ({ key: String(d), label: `${d}s`, n, filter: { from: d, to: d + 9 } }))

  const credited = (kind: number) =>
    tally(recs, (r) => (r.people || []).filter(([, m]) => m & kind).map(([i]) => i))
      .slice(0, 10)
      .map(([i, n]) => ({ key: String(i), label: people[i]?.[0] || '?', sub: people[i]?.[1], n, filter: { people: [i] } }))

  const artistIds = new Map<string, number | null>()
  for (const r of recs) if (!artistIds.has(r.artist)) artistIds.set(r.artist, r.artistId ?? null)

  const comp = store.snapshot.completeness || {}
  const names = new Map(recs.filter((r) => r.artistId).map((r) => [r.artistId!, r.artist]))
  const complete: Row[] = Object.entries(comp)
    .filter(([, [h, t]]) => t >= 3 && t - h <= 1)
    .sort((a, b) => b[1][0] - a[1][0])
    .slice(0, 15)
    .map(([id, [h, t]]) => ({
      key: id,
      label: names.get(Number(id)) || id,
      sub: h === t ? 'every studio album' : `${h} of ${t} studio albums`,
      n: h,
      to: `artist/${id}`,
    }))

  const withHave = recs.filter((r) => r.have != null && r.have > 0)
  const priced = recs.filter((r) => r.value != null)
  const byYear = recs.filter((r) => yearOf(r)).sort((a, b) => yearOf(a)! - yearOf(b)!)

  return {
    records: recs.length,
    artists: artistIds.size,
    firsts: recs.filter((r) => r.press === 'first').length,
    value: priced.reduce((t, r) => t + r.value!, 0),
    priced: priced.length,
    decades,
    genres: top(tally(recs, (r) => r.genres), 10, (g) => ({ genres: [g] })),
    styles: top(tally(recs, (r) => r.styles), 15, (st) => ({ styles: [st] })),
    labels: top(tally(recs, (r) => r.label || null), 12, (l) => ({ labels: [l] })),
    topArtists: tally(recs, (r) => r.artist)
      .slice(0, 12)
      .map(([a, n]) => ({ key: a, label: a, n, to: artistIds.get(a) ? `artist/${artistIds.get(a)}` : undefined, filter: artistIds.get(a) ? undefined : { text: a } })),
    players: credited(PLAY),
    engineers: credited(ENG),
    producers: credited(PROD),
    verdicts: tally(recs, (r) => r.press || null).map(([k, n]) => ({ key: k, label: VERDICTS[k] || k, n })),
    countries: top(tally(recs, (r) => r.country || null), 10),
    plants: top(tally(recs, (r) => r.plant || null), 10),
    complete,
    rarest: [...withHave].sort((a, b) => a.have! - b.have!).slice(0, 8),
    wanted: withHave
      .filter((r) => r.have! >= 25)
      .sort((a, b) => b.want! / b.have! - a.want! / a.have!)
      .slice(0, 8),
    valuable: [...priced].sort((a, b) => b.value! - a.value!).slice(0, 8),
    ends: [...byYear.slice(0, 3), ...byYear.slice(-3).reverse()],
    added: tally(recs, (r) => r.addedAt?.slice(0, 4) || null)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([y, n]) => ({ key: y, label: y, n })),
  }
}
