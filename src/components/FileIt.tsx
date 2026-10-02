import { useEffect, useRef, useState } from 'react'
import { api, img } from '../api'
import type { BackCoverRead, LookupResult, PlaceResponse, RecordSummary } from '../types'

/* ------------------------------------------------------------------ */
/* Recognising a sleeve from a photo                                   */
/* ------------------------------------------------------------------ */

/**
 * Difference hash: shrink to 9x8 greyscale and record whether each pixel is
 * brighter than the one to its right. The result survives rescaling, recompression
 * and moderate colour shifts, which is what separates a phone snap from the clean
 * scan Discogs holds.
 */
async function dHash(src: CanvasImageSource): Promise<bigint> {
  const canvas = document.createElement('canvas')
  canvas.width = 9
  canvas.height = 8
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(src, 0, 0, 9, 8)
  const { data } = ctx.getImageData(0, 0, 9, 8)
  const grey = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

  let hash = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = grey((y * 9 + x) * 4)
      const right = grey((y * 9 + x + 1) * 4)
      hash = (hash << 1n) | (left > right ? 1n : 0n)
    }
  }
  return hash
}

function hamming(a: bigint, b: bigint) {
  let x = a ^ b
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}

const hashCache = new Map<number, bigint>()

/** Hash every sleeve we hold, a few at a time, so a photo can be matched against them. */
async function indexCollection(records: RecordSummary[], onProgress: (n: number) => void) {
  const todo = records.filter((r) => !hashCache.has(r.instanceId) && (r.thumb || r.cover))
  let done = 0
  const queue = [...todo]
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (;;) {
        const r = queue.shift()
        if (!r) return
        try {
          const image = await loadImage(img(r.thumb || r.cover))
          hashCache.set(r.instanceId, await dHash(image))
        } catch {
          /* a sleeve we can't read just doesn't take part in matching */
        }
        if (++done % 25 === 0) onProgress(hashCache.size)
      }
    }),
  )
  onProgress(hashCache.size)
}

/* ------------------------------------------------------------------ */

interface Props {
  records: RecordSummary[]
  onClose: () => void
  onOpenRecord: (r: RecordSummary) => void
}

type Stage = 'start' | 'working' | 'choose' | 'placed'

/**
 * A record of your own that the photo might be. `note` says why it is a candidate,
 * because "the sleeve looks like this" and "the catalogue number is this" are
 * different kinds of evidence and shouldn't be presented as the same thing.
 */
interface SelfMatch {
  record: RecordSummary
  distance: number
  note?: string
}

export function FileIt({ records, onClose, onOpenRecord }: Props) {
  const [stage, setStage] = useState<Stage>('start')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [matches, setMatches] = useState<SelfMatch[]>([])
  const [results, setResults] = useState<LookupResult[]>([])
  const [placed, setPlaced] = useState<PlaceResponse | null>(null)
  const [query, setQuery] = useState('')
  const [indexed, setIndexed] = useState(hashCache.size)
  const [read, setRead] = useState<BackCoverRead | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const backRef = useRef<HTMLInputElement>(null)

  // Build the sleeve index up front so a photo can be matched the moment it arrives.
  useEffect(() => {
    let live = true
    indexCollection(records, (n) => live && setIndexed(n))
    return () => {
      live = false
    }
  }, [records])

  async function handlePhoto(file: File) {
    setError(null)
    setStage('working')
    setStatus('Reading the photo…')
    const url = URL.createObjectURL(file)
    setPhoto(url)

    try {
      const bitmap = await createImageBitmap(file)

      // A barcode is the only truly certain identification, so try it first.
      const Detector = (window as any).BarcodeDetector
      if (Detector) {
        try {
          setStatus('Looking for a barcode…')
          const detector = new Detector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
          })
          const found = await detector.detect(bitmap)
          const code = found?.[0]?.rawValue
          if (code) {
            setStatus(`Barcode ${code} — searching Discogs…`)
            const { results } = await api.lookup({ barcode: code })
            if (results.length) {
              setResults(results)
              setMatches([])
              setStage('choose')
              return
            }
          }
        } catch {
          /* no detector support, or nothing readable — fall through to the sleeve match */
        }
      }

      setStatus('Matching against your sleeves…')
      const hash = await dHash(bitmap)
      const scored = records
        .map((r) => {
          const h = hashCache.get(r.instanceId)
          return h === undefined ? null : { record: r, distance: hamming(hash, h) }
        })
        .filter(Boolean) as { record: RecordSummary; distance: number }[]
      scored.sort((a, b) => a.distance - b.distance)

      const close = scored.filter((s) => s.distance <= 20).slice(0, 6)
      if (close.length) {
        setMatches(close)
        setResults([])
        setStage('choose')
        return
      }

      // Not one of ours, so read the sleeve instead. This is the case that matters
      // in a shop: the front is artwork, but the back is typeset, and the
      // catalogue number on it names the pressing.
      setStatus('Not one of yours — reading the sleeve…')
      await readBack(file)
    } catch (err) {
      setError((err as Error).message)
      setStage('start')
    }
  }

  /**
   * Read a photograph of the back of a sleeve, which is where the catalogue number
   * lives. Needs the sleeve to fill the frame: the number is set in about 7pt, and
   * below roughly 1700px across the sleeve it is physically too small to resolve.
   */
  async function readBack(file: File) {
    setError(null)
    setStage('working')
    setStatus('Reading the catalogue number…')
    setPhoto((current) => current ?? URL.createObjectURL(file))
    try {
      const found = await api.readBackCover(file)
      setRead(found)
      setResults(found.results)
      setMatches(
        found.owned
          .map((o) => {
            const record = records.find((r) => r.instanceId === o.instanceId)
            if (!record) return null
            return {
              record,
              distance: 0,
              note: o.match === 1 ? 'same catalogue number' : 'catalogue number is close',
            }
          })
          .filter(Boolean) as SelfMatch[],
      )
      setStage('choose')
      if (!found.results.length && !found.owned.length) {
        setError(
          found.read.catalogueNumbers.length
            ? "Read a catalogue number but Discogs doesn't know it — try the search below."
            : "Couldn't find a catalogue number in that. It's usually on the back or the spine, " +
              'sometimes a corner of the front — get in close so it fills the frame.',
        )
      }
    } catch (err) {
      setError((err as Error).message)
      setStage('choose')
    }
  }

  async function search(q: string) {
    if (!q.trim()) return
    setError(null)
    setStage('working')
    setStatus('Searching Discogs…')
    try {
      const { results } = await api.lookup({ q })
      setResults(results)
      setMatches([])
      setStage('choose')
      if (!results.length) setError('Nothing found on Discogs for that.')
    } catch (err) {
      setError((err as Error).message)
      setStage('choose')
    }
  }

  async function place(body: { instanceId?: number; releaseId?: number }) {
    setStage('working')
    setStatus('Working out where it goes…')
    try {
      setPlaced(await api.place(body))
      setStage('placed')
    } catch (err) {
      setError((err as Error).message)
      setStage('choose')
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="file-sheet">
        <button className="sheet-close" onClick={onClose} title="Close (Esc)">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>

        {stage === 'placed' && placed ? (
          <PlacementCard
            placed={placed}
            records={records}
            onOpenRecord={onOpenRecord}
            onAgain={() => {
              setPlaced(null)
              setPhoto(null)
              setMatches([])
              setResults([])
              setRead(null)
              setStage('start')
            }}
          />
        ) : (
          <>
            <h2 className="file-title">Where does it go?</h2>
            <p className="file-sub">
              Photograph the sleeve and it'll tell you the cube and the two records to slide it
              between. For something you don't own, photograph the{' '}
              <strong>catalogue number</strong> — close in, so it fills the frame. That one
              string names the exact pressing, and reading it is far surer than reading a sleeve.
            </p>

            <div className="file-actions">
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2 5.5A1.5 1.5 0 013.5 4h1L5.5 2.5h5L11.5 4h1A1.5 1.5 0 0114 5.5v7A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-7z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <circle cx="8" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
                Take a photo
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0])}
              />
              <button className="btn btn-primary" onClick={() => backRef.current?.click()}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <path d="M2.5 5.2V3.4a.9.9 0 01.9-.9h1.8M13.5 5.2V3.4a.9.9 0 00-.9-.9h-1.8M2.5 10.8v1.8a.9.9 0 00.9.9h1.8M13.5 10.8v1.8a.9.9 0 01-.9.9h-1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <path d="M5 8h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Catalogue number
              </button>
              <input
                ref={backRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => e.target.files?.[0] && readBack(e.target.files[0])}
              />
              <div className="search" style={{ flex: 1, minWidth: 180 }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  placeholder="…or type the artist and title"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search(query)}
                />
              </div>
            </div>

            <div className="file-index">
              {indexed < records.length
                ? `Reading your sleeves for matching — ${indexed} of ${records.length}`
                : `${records.length} sleeves ready to match against`}
            </div>

            {photo && (
              <div className="file-photo">
                <img src={photo} alt="the record you photographed" />
              </div>
            )}

            {stage === 'working' && (
              <div className="file-status">
                <span className="spinner" /> {status}
              </div>
            )}
            {error && <div className="file-error">{error}</div>}

            {read && stage !== 'working' && <WhatWasRead read={read} />}

            {matches.length > 0 && (
              <>
                <h4 className="mini-label" style={{ marginTop: 22 }}>
                  From your own shelves
                </h4>
                <div className="file-results">
                  {matches.map(({ record, distance, note }) => (
                    <button
                      key={record.instanceId}
                      className="file-result"
                      onClick={() => place({ instanceId: record.instanceId })}
                    >
                      {record.thumb && <img src={img(record.thumb)} alt="" />}
                      <span className="fr-text">
                        <strong>{record.title}</strong>
                        <span>{record.artist}</span>
                      </span>
                      <span className={`fr-conf ${note || distance <= 10 ? 'good' : ''}`}>
                        {note ??
                          (distance <= 8 ? 'strong match' : distance <= 14 ? 'likely' : 'possible')}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {results.length > 0 && (
              <>
                <h4 className="mini-label" style={{ marginTop: 22 }}>
                  From Discogs
                </h4>
                <div className="file-results">
                  {results.map((r) => (
                    <button
                      key={r.releaseId}
                      className="file-result"
                      onClick={() => place({ releaseId: r.releaseId })}
                    >
                      {r.thumb && <img src={img(r.thumb)} alt="" />}
                      <span className="fr-text">
                        <strong>{r.title}</strong>
                        <span>
                          {[r.year, r.label, r.catno, r.country].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="fr-conf">{r.format.split(',')[0]}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * What came off the sleeve, shown rather than hidden.
 *
 * The reader returns candidates, not answers, and the catalogue number is the one
 * that decides which pressing you're holding — so it's worth seeing what was read,
 * both to trust the result and to spot a misread before acting on it.
 */
function WhatWasRead({ read }: { read: BackCoverRead }) {
  const { catalogueNumbers, phrases, resolutionOk, pixelsAcross } = read.read
  return (
    <div className="file-read">
      {!resolutionOk && (
        <p className="file-read-warn">
          That sleeve came out {pixelsAcross}px across. The catalogue number is set in about
          7pt, so it needs roughly 1700px — fill the frame with the sleeve for a surer read.
        </p>
      )}
      {catalogueNumbers.length > 0 && (
        <p className="file-read-line">
          <span className="mini-label">Catalogue number</span>
          {catalogueNumbers.slice(0, 3).map((c) => (
            <code key={c.value}>{c.value}</code>
          ))}
        </p>
      )}
      {phrases.length > 0 && (
        <p className="file-read-line">
          <span className="mini-label">Read off the sleeve</span>
          <em>{phrases.slice(0, 2).join(' · ')}</em>
        </p>
      )}
    </div>
  )
}

function PlacementCard({
  placed,
  records,
  onOpenRecord,
  onAgain,
}: {
  placed: PlaceResponse
  records: RecordSummary[]
  onOpenRecord: (r: RecordSummary) => void
  onAgain: () => void
}) {
  const { record, placement } = placed
  if (!placement) {
    return (
      <div className="place-card">
        <h2 className="file-title">{record.title}</h2>
        <p className="file-sub">That shelf isn't on the unit, so there's nowhere to put it yet.</p>
        <button className="btn btn-ghost" onClick={onAgain}>
          Try another
        </button>
      </div>
    )
  }

  const open = (instanceId: number) => {
    const r = records.find((x) => x.instanceId === instanceId)
    if (r) onOpenRecord(r)
  }

  return (
    <div className="place-card">
      <div className="place-head">
        <h2>{record.title}</h2>
        <div className="by">{record.artist}</div>
        <div className="filed">
          filed under “{record.sortName}”
          {record.originalYear ? ` · ${record.originalYear}` : ''}
        </div>
      </div>

      <div className="place-cube">
        <div className="pc-num">{placement.cube.index + 1}</div>
        <div className="pc-text">
          <strong>{placement.shelfName}</strong>
          <span>
            {placement.cube.label} · row {placement.cube.row + 1}, column {placement.cube.col + 1}
          </span>
          <span className="pc-pos">
            position {placement.position} of {placement.cube.count + 1}
          </span>
        </div>
      </div>

      <div className="place-between">
        <Neighbour
          label={placement.atCubeStart ? 'first in the cube — nothing before it' : 'slide it in after'}
          n={placement.before}
          onOpen={open}
        />
        <div className="place-here">
          <span>▼ here ▼</span>
        </div>
        <Neighbour
          label={placement.atCubeEnd ? 'last in the cube — nothing after it' : 'and before'}
          n={placement.after}
          onOpen={open}
        />
      </div>

      <button className="btn btn-ghost" style={{ margin: '22px auto 0' }} onClick={onAgain}>
        File another
      </button>
    </div>
  )
}

function Neighbour({
  label,
  n,
  onOpen,
}: {
  label: string
  n: PlaceResponse['placement'] extends null ? never : any
  onOpen: (id: number) => void
}) {
  if (!n) return <div className="neighbour empty">{label}</div>
  return (
    <button className="neighbour" onClick={() => onOpen(n.instanceId)}>
      <span className="nb-label">{label}</span>
      <span className="nb-row">
        {n.cover && <img src={img(n.cover)} alt="" />}
        <span className="nb-text">
          <strong>{n.title}</strong>
          <span>
            {n.artist}
            {n.year ? ` · ${n.year}` : ''}
          </span>
        </span>
      </span>
    </button>
  )
}
