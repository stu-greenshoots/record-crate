import type { Rec } from './types'

/**
 * Type-to-find over the collection. With ~600 records a straight scan per keystroke
 * is instant, so this is about ranking rather than speed: every word you type must
 * appear somewhere, and a word that starts a name beats one buried in the middle.
 * "zep hou" finds Houses Of The Holy; "k 50014" finds it by catalogue number.
 */

export function fold(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

interface Indexed {
  rec: Rec
  artist: string
  title: string
  other: string
  catno: string
}

let cache: { source: Rec[]; items: Indexed[] } | null = null

function index(records: Rec[]) {
  if (cache?.source === records) return cache.items
  const items = records.map((rec) => ({
    rec,
    artist: ` ${fold(`${rec.artist} ${rec.credit} ${rec.sortName}`)}`,
    title: ` ${fold(rec.title)}`,
    other: ` ${fold(`${rec.label} ${rec.year ?? ''} ${rec.originalYear ?? ''}`)}`,
    catno: fold(rec.catno).replace(/ /g, ''),
  }))
  cache = { source: records, items }
  return items
}

function wordScore(field: string, word: string, weight: number) {
  const at = field.indexOf(word)
  if (at < 0) return 0
  // A hit at the start of a word (field strings are space-prefixed).
  const start = field[at - 1] === ' '
  const whole = start && (field[at + word.length] === ' ' || at + word.length === field.length)
  return weight * (whole ? 3 : start ? 2 : 0.6)
}

export function search(records: Rec[], query: string, limit = 40): Rec[] {
  const q = fold(query)
  if (!q) return []
  const words = q.split(' ')
  const compact = q.replace(/ /g, '')
  const scored: { rec: Rec; score: number }[] = []

  for (const it of index(records)) {
    let total = 0
    let ok = true
    for (const w of words) {
      const s = Math.max(wordScore(it.artist, w, 1.2), wordScore(it.title, w, 1), wordScore(it.other, w, 0.4))
      if (!s) {
        ok = false
        break
      }
      total += s
    }
    // Catalogue numbers are typed any old way: "K50014", "k 50014".
    if (compact.length >= 3 && it.catno.includes(compact)) {
      total = Math.max(total, 10)
      ok = true
    }
    if (ok) scored.push({ rec: it.rec, score: total })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.rec.sortName.localeCompare(b.rec.sortName))
    .slice(0, limit)
    .map((s) => s.rec)
}
