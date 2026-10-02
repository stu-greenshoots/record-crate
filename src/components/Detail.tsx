import { useEffect, useMemo, useState } from 'react'
import { api, img } from '../api'
import type { CubeRef, MarketInfo, RecordSummary, ReleaseDetail, Shelf } from '../types'
import { BlankSleeve } from './Sleeve'

interface Props {
  record: RecordSummary
  shelves: Shelf[]
  currency: string
  hasPrev: boolean
  hasNext: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onShelf: (shelfId: string) => void
  onSortName: (artistKey: string, sortName: string | null) => void
}

function money(v: number | null | undefined, currency: string) {
  if (v == null) return null
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: v < 20 ? 2 : 0,
    }).format(v)
  } catch {
    return `${currency} ${v}`
  }
}

const BASIS_LABEL: Record<string, string> = {
  override: 'your rule',
  discogs: 'from Discogs',
  guess: 'best guess',
  plain: 'as written',
}

export function Detail(props: Props) {
  const { record, shelves, currency } = props
  const [detail, setDetail] = useState<ReleaseDetail | null>(null)
  const [market, setMarket] = useState<MarketInfo | null>(null)
  const [cube, setCube] = useState<CubeRef | null>(null)
  const [loading, setLoading] = useState(true)
  const [flipped, setFlipped] = useState(false)
  const [backIdx, setBackIdx] = useState(1)
  const [editingFiled, setEditingFiled] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    setDetail(null)
    setFlipped(false)
    setBackIdx(1)
    api
      .record(record.instanceId)
      .then((res) => {
        if (!live) return
        setDetail(res.detail)
        setMarket(res.market)
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [record.instanceId])

  /**
   * Which cube a record stands in changes the moment you move it to another shelf,
   * so it's tracked separately from the sleeve and price — otherwise the panel keeps
   * showing where the record used to live and the unit looks wrong when it isn't.
   */
  useEffect(() => {
    let live = true
    setCube(null)
    api
      .record(record.instanceId)
      .then((res) => live && setCube(res.cube))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [record.instanceId, record.shelf])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') props.onClose()
      if (e.key === 'ArrowLeft' && props.hasPrev) props.onPrev()
      if (e.key === 'ArrowRight' && props.hasNext) props.onNext()
      if (e.key === 'f') setFlipped((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const images = detail?.images ?? []
  const front = images[0]?.uri || record.cover
  const back = images[backIdx]?.uri || record.back

  const creditGroups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const c of detail?.credits ?? []) {
      for (const role of c.role.split(',').map((r) => r.trim()).filter(Boolean)) {
        if (!map.has(role)) map.set(role, [])
        map.get(role)!.push(c.name)
      }
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 24)
  }, [detail])

  const lowest = market?.stats?.lowest_price?.value ?? detail?.lowestPrice ?? null
  const marketCurrency = market?.stats?.lowest_price?.currency || currency
  const suggestions = market?.suggestions
    ? Object.entries(market.suggestions).sort((a, b) => b[1].value - a[1].value)
    : []

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="sheet">
        {front && (
          <div className="sheet-glow" aria-hidden>
            <img src={img(front)} alt="" />
          </div>
        )}

        <div className="sheet-nav">
          <button onClick={props.onPrev} disabled={!props.hasPrev} title="Previous record">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button onClick={props.onNext} disabled={!props.hasNext} title="Next record">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <button className="sheet-close" onClick={props.onClose} title="Close (Esc)">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>

        <div className="sheet-left">
          <div
            className={`flipper ${flipped ? 'flipped' : ''}`}
            onClick={() => back && setFlipped((v) => !v)}
            title={back ? 'Click to flip' : 'No reverse scan on Discogs'}
          >
            <div className="flipper-inner">
              <div className="flipper-face">
                {front ? (
                  <img src={img(front)} alt={record.title} />
                ) : (
                  <BlankSleeve title={record.title} artist={record.artistName} />
                )}
              </div>
              <div className="flipper-face flipper-back">
                {back ? (
                  <img src={img(back)} alt={`${record.title} reverse`} />
                ) : (
                  <BlankSleeve title="No reverse scan" artist={record.artistName} />
                )}
              </div>
            </div>
          </div>

          <div className="flip-hint">
            {loading ? (
              <>
                <span className="spinner" /> pulling the sleeve…
              </>
            ) : back ? (
              <>Click the sleeve to flip · {images.length} scans</>
            ) : (
              <>Front only — no reverse scanned on Discogs</>
            )}
          </div>

          {images.length > 1 && (
            <div className="thumbs">
              {images.slice(1).map((im, i) => (
                <button
                  key={im.uri}
                  className={backIdx === i + 1 ? 'on' : ''}
                  onClick={() => {
                    setBackIdx(i + 1)
                    setFlipped(true)
                  }}
                  title={im.type}
                >
                  <img src={img(im.thumb || im.uri)} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="sheet-right">
          <div className="detail-head">
            <h1>{record.title}</h1>
            <div className="by">{record.artist}</div>
            <div className="line">
              {/* The album's own year leads; the pressing date follows when it differs. */}
              {(record.originalYear || record.year) && <span>{record.originalYear || record.year}</span>}
              {record.isReissue && (
                <span className="dot-sep">this copy {detail?.released || record.year}</span>
              )}
              {detail?.country && <span className="dot-sep">{detail.country}</span>}
              {record.formatLine && <span className="dot-sep">{record.formatLine}</span>}
            </div>
          </div>

          <div className="stat-row">
            <div className="stat">
              <div className="k">Lowest listed</div>
              <div className="v accent">{money(lowest, marketCurrency) ?? '—'}</div>
              <div className="s">
                {market?.stats?.num_for_sale != null
                  ? `${market.stats.num_for_sale} for sale`
                  : 'not currently listed'}
              </div>
            </div>
            <div className="stat">
              <div className="k">Have</div>
              <div className="v">{detail?.community?.have?.toLocaleString() ?? '—'}</div>
              <div className="s">collectors</div>
            </div>
            <div className="stat">
              <div className="k">Want</div>
              <div className="v">{detail?.community?.want?.toLocaleString() ?? '—'}</div>
              <div className="s">
                {detail?.community?.have && detail?.community?.want
                  ? `${(detail.community.want / Math.max(detail.community.have, 1)).toFixed(2)} ratio`
                  : 'wantlists'}
              </div>
            </div>
            <div className="stat">
              <div className="k">Rating</div>
              <div className="v">
                {detail?.community?.rating?.average
                  ? detail.community.rating.average.toFixed(2)
                  : '—'}
              </div>
              <div className="s">
                {detail?.community?.rating?.count
                  ? `${detail.community.rating.count} votes`
                  : 'unrated'}
              </div>
            </div>
          </div>

          <div className="section">
            <h4>
              Filed under <i />
            </h4>
            <div className="filed-row">
              {editingFiled ? (
                <input
                  autoFocus
                  defaultValue={record.sortName}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    props.onSortName(record.artistKey, v || null)
                    setEditingFiled(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditingFiled(false)
                  }}
                />
              ) : (
                <>
                  <span className="name">{record.sortName}</span>
                  <span className={`chip-basis ${record.sortBasis}`}>
                    {BASIS_LABEL[record.sortBasis]}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingFiled(true)}>
                    Change
                  </button>
                </>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
              Applies to everything by {record.artistName}.
            </div>
          </div>

          <div className="section">
            <h4>
              Shelf <i />
            </h4>
            <div className="chips">
              {shelves.map((s) => (
                <button
                  key={s.id}
                  className={`chip ${record.shelf === s.id ? 'on' : ''}`}
                  onClick={() => props.onShelf(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {cube && (
            <div className="section">
              <h4>
                On the unit <i />
              </h4>
              <div className="filed-row">
                <span className="name">
                  Cube {cube.index + 1} · {cube.label}
                </span>
                <span className="chip-basis">
                  row {cube.row + 1}, col {cube.col + 1}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
                Standing with {cube.count - 1} other{cube.count === 2 ? '' : 's'} in that cube.
              </div>
            </div>
          )}

          {(record.genres.length > 0 || record.styles.length > 0) && (
            <div className="section">
              <h4>
                Sound <i />
              </h4>
              <div className="chips">
                {record.genres.map((g) => (
                  <span key={g} className="chip on">
                    {g}
                  </span>
                ))}
                {record.styles.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="section">
            <h4>
              Pressing <i />
            </h4>
            <dl className="kv">
              {record.labels.map((l, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <dt>{i === 0 ? 'Label' : ''}</dt>
                  <dd>
                    {l.name} {l.catno && <span className="mono"> · {l.catno}</span>}
                  </dd>
                </div>
              ))}
              {record.formatLine && (
                <>
                  <dt>Format</dt>
                  <dd>{record.formatLine}</dd>
                </>
              )}
              {detail?.country && (
                <>
                  <dt>Country</dt>
                  <dd>{detail.country}</dd>
                </>
              )}
              {detail?.released && (
                <>
                  <dt>Released</dt>
                  <dd>{detail.released}</dd>
                </>
              )}
              <dt>Added</dt>
              <dd>{new Date(record.addedAt).toLocaleDateString()}</dd>
              {(detail?.identifiers ?? []).slice(0, 4).map((id, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <dt>{id.type}</dt>
                  <dd className="mono">
                    {id.value}
                    {id.description ? ` (${id.description})` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {suggestions.length > 0 && (
            <div className="section">
              <h4>
                What it goes for <i />
              </h4>
              <dl className="kv">
                {suggestions.map(([condition, v]) => (
                  <div key={condition} style={{ display: 'contents' }}>
                    <dt>{condition}</dt>
                    <dd>{money(v.value, v.currency || marketCurrency)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {(detail?.tracklist?.length ?? 0) > 0 && (
            <div className="section">
              <h4>
                Tracklist <i />
              </h4>
              <div className="tracklist">
                {detail!.tracklist.map((t, i) =>
                  t.type === 'heading' ? (
                    <div key={i} className="track heading">
                      {t.title}
                    </div>
                  ) : (
                    <div key={i} className="track">
                      <span className="pos">{t.position}</span>
                      <span>
                        {t.title}
                        {t.artists.length > 0 && (
                          <span className="tcredit">{t.artists.join(', ')}</span>
                        )}
                        {t.credits.length > 0 && (
                          <span className="tcredit">
                            {t.credits
                              .slice(0, 4)
                              .map((c) => `${c.role}: ${c.name}`)
                              .join(' · ')}
                          </span>
                        )}
                      </span>
                      <span className="dur">{t.duration}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {creditGroups.length > 0 && (
            <div className="section">
              <h4>
                Credits <i />
              </h4>
              <div className="credits">
                {creditGroups.map(([role, names]) => (
                  <div className="credit-row" key={role}>
                    <span className="role">{role}</span>
                    <span>{[...new Set(names)].join(', ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail?.notes && (
            <div className="section">
              <h4>
                Notes <i />
              </h4>
              <div className="notes">{detail.notes}</div>
            </div>
          )}

          {(detail?.videos?.length ?? 0) > 0 && (
            <div className="section">
              <h4>
                Listen <i />
              </h4>
              <div className="videos">
                {detail!.videos.map((v) => (
                  <a key={v.uri} className="video-link" href={v.uri} target="_blank" rel="noreferrer">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M5 3.5v9l8-4.5-8-4.5z" />
                    </svg>
                    <span>{v.title}</span>
                    <span className="dur">
                      {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, '0')}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="section">
            <a
              className="link-out"
              href={detail?.uri || `https://www.discogs.com/release/${record.releaseId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open on Discogs
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 3h7v7M13 3L4 12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
