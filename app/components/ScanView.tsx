import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { back, go } from '../route'
import { merge, onRecogniser, recognise, warmUp, type Match, type RecogniserState } from '../recognise'
import type { Rec } from '../types'
import { Sleeve } from './Sleeve'
import { CloseIcon, ImageIcon, TorchIcon } from './Icons'

/** Side of the square handed to the recogniser; the model works at 224. */
const SAMPLE = 320

/**
 * When to trust the top match without asking, measured on 360 synthetic phone
 * photos of real sleeves plus 60 things that aren't sleeves (shelf backgrounds,
 * collages of other covers, plain card):
 *
 *  - no wrong sleeve ever led the runner-up by more than 0.067;
 *  - non-sleeves could lead by 0.10, but never scored above 0.67 outright;
 *  - so: score at least FLOOR and lead by SURE, or by STEADY on two frames running.
 *
 * That accepts 286 of 342 right answers on sight with no wrong ones; the rest are a
 * tap away in the shortlist.
 */
const FLOOR = 0.68
const SURE = 0.07
const STEADY = 0.06
/** Below this the frame probably isn't one of your sleeves at all. */
const STRANGER = 0.6

type Found = { rec: Rec; score: number }

export function ScanView() {
  const store = useStore()
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [model, setModel] = useState<RecogniserState>({ status: 'idle', progress: 0 })
  const [camera, setCamera] = useState<'starting' | 'live' | 'denied' | 'unsupported'>('starting')
  const [guesses, setGuesses] = useState<Found[]>([])
  const [frames, setFrames] = useState(0)
  const [busyPhoto, setBusyPhoto] = useState(false)
  const [stranger, setStranger] = useState(false)
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean } | null>(null)

  const toggleTorch = async () => {
    if (!torch) return
    const on = !torch.on
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorch({ ...torch, on })
    } catch {
      setTorch(null)
    }
  }
  const done = useRef(false)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => {
    const on = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const guide = guideSize(viewport.w, viewport.h)

  const byRelease = useMemo(() => {
    const m = new Map<number, Rec>()
    for (const r of store?.records || []) if (!m.has(r.releaseId)) m.set(r.releaseId, r)
    return m
  }, [store])

  useEffect(() => {
    warmUp()
    return onRecogniser(setModel)
  }, [])

  // Camera.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported')
      return
    }
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const v = video.current!
        v.srcObject = s
        await v.play().catch(() => {})
        setCamera('live')
        const track = s.getVideoTracks()[0]
        const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean }
        if (caps.torch) setTorch({ track, on: false })
      })
      .catch(() => setCamera('denied'))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const accept = (rec: Rec) => {
    if (done.current) return
    done.current = true
    navigator.vibrate?.([18, 40, 18])
    go(`r/${rec.id}`, true)
  }

  const toFound = (matches: Match[]) =>
    matches
      .map((m) => ({ rec: byRelease.get(m.releaseId)!, score: m.score }))
      .filter((f) => f.rec)

  // The scanning loop: one frame at a time, as fast as the recogniser answers.
  useEffect(() => {
    if (camera !== 'live' || model.status !== 'ready') return
    let live = true
    let lastTop: number | null = null
    let previous: Match[] = []
    let n = 0
    ;(async () => {
      while (live && !done.current) {
        const frame = grabSquare(video.current!, canvas.current!)
        if (!frame) {
          await new Promise((r) => setTimeout(r, 120))
          continue
        }
        // Alternate the two views and judge on this frame plus the last.
        const { matches } = await recognise(frame, n++ % 2 ? 'centre' : 'full')
        if (!live) return
        const found = toFound(merge(matches, previous))
        previous = matches
        setFrames((n) => n + 1)
        setGuesses(found.slice(0, 4))
        if (found.length > 1) {
          const lead = found[0].score - found[1].score
          const top = found[0].rec.releaseId
          setStranger(found[0].score < STRANGER)
          if (found[0].score >= FLOOR && (lead >= SURE || (lead >= STEADY && lastTop === top))) {
            accept(found[0].rec)
            return
          }
          lastTop = top
        }
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, model.status, byRelease])

  // A still photo, for when the live camera isn't available.
  const onPhoto = async (file: File) => {
    setBusyPhoto(true)
    try {
      const bitmap = await createImageBitmap(file)
      const c = canvas.current!
      const side = Math.min(bitmap.width, bitmap.height) * 0.86
      c.width = c.height = SAMPLE
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SAMPLE, SAMPLE)
      const { matches } = await recognise(ctx.getImageData(0, 0, SAMPLE, SAMPLE))
      const found = toFound(matches)
      setGuesses(found.slice(0, 4))
      setFrames((n) => n + 1)
      if (found.length > 1 && found[0].score >= FLOOR && found[0].score - found[1].score >= SURE) {
        accept(found[0].rec)
      }
    } finally {
      setBusyPhoto(false)
    }
  }

  const status = (() => {
    if (camera === 'denied') return 'No camera access — allow it in your browser settings, or take a photo instead.'
    if (camera === 'unsupported') return 'This browser has no live camera here — take a photo instead.'
    if (model.status === 'error') return `The recogniser didn't load: ${model.error}`
    if (model.status !== 'ready') {
      return model.progress > 0 && model.progress < 100
        ? `Getting the recogniser ready… ${Math.round(model.progress)}%`
        : 'Getting the recogniser ready…'
    }
    if (camera === 'starting') return 'Starting the camera…'
    if (frames < 3) return 'Fill the square with the front of the sleeve'
    if (stranger) return "Not sure that's one of yours — fill the square with the sleeve"
    return 'Hold it steady — or tap the one it is'
  })()

  const live = camera === 'live' || camera === 'starting'

  return (
    <div className="scan">
      <video ref={video} className="scan-video" playsInline muted autoPlay />
      <canvas ref={canvas} hidden />

      <div className="scan-shade" aria-hidden>
        <div
          className={`scan-guide ${model.status === 'ready' && camera === 'live' ? 'active' : ''}`}
          style={{ width: guide, height: guide, marginTop: guideOffset(viewport.h) * 2 }}
        >
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>

      <header className="scan-top">
        <button type="button" className="icon-btn glass" onClick={() => back()} aria-label="Close">
          <CloseIcon />
        </button>
        {torch && (
          <button
            type="button"
            className={`icon-btn glass torch ${torch.on ? 'on' : ''}`}
            onClick={toggleTorch}
            aria-label={torch.on ? 'Light off' : 'Light on'}
            aria-pressed={torch.on}
          >
            <TorchIcon />
          </button>
        )}
        <label className="icon-btn glass" aria-label="Use a photo">
          <ImageIcon />
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])}
          />
        </label>
      </header>

      <footer className="scan-bottom">
        <p className="scan-status">{busyPhoto ? 'Looking…' : status}</p>
        {!live && (
          <label className="btn btn-primary btn-big">
            Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => e.target.files?.[0] && onPhoto(e.target.files[0])}
            />
          </label>
        )}
        {guesses.length > 0 && frames >= 2 && (
          <div className="guesses">
            {guesses.map((g) => (
              <button type="button" key={g.rec.id} className="guess" onClick={() => accept(g.rec)}>
                <Sleeve rec={g.rec} className="guess-sleeve" />
                <span className="guess-title">{g.rec.title}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="link-btn" onClick={() => go('', true)}>
          Type it instead
        </button>
      </footer>
    </div>
  )
}

/**
 * Copy the part of the frame inside the on-screen guide square. The video is drawn
 * with object-fit: cover, so screen coordinates have to be mapped back through the
 * crop and scale to find the same square in the camera's own pixels.
 */
export function grabSquare(v: HTMLVideoElement, c: HTMLCanvasElement): ImageData | null {
  if (!v.videoWidth || v.readyState < 2) return null
  const vw = v.videoWidth
  const vh = v.videoHeight
  const ew = v.clientWidth
  const eh = v.clientHeight
  const scale = Math.max(ew / vw, eh / vh)
  const guide = guideSize(ew, eh)
  const side = guide / scale
  const cx = vw / 2
  const cy = vh / 2 + guideOffset(eh) / scale
  c.width = c.height = SAMPLE
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(v, cx - side / 2, cy - side / 2, side, side, 0, 0, SAMPLE, SAMPLE)
  return ctx.getImageData(0, 0, SAMPLE, SAMPLE)
}

/** Kept in step with .scan-guide in the stylesheet. */
export function guideSize(w: number, h: number) {
  return Math.min(w * 0.82, h * 0.56)
}
function guideOffset(h: number) {
  return -h * 0.06
}
