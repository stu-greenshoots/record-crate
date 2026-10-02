import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.js'

/**
 * The bridge to the Python image work.
 *
 * OpenCV and tesseract live in `.venv`, so the Node side shells out and reads
 * JSON back rather than trying to do any of this in process.
 */

const PYTHON = path.join(ROOT, '.venv', 'bin', 'python')

export function pythonAvailable() {
  return fs.existsSync(PYTHON)
}

function runPython(args, { timeout = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!pythonAvailable()) {
      return reject(new Error('The Python environment is missing — see HANDOVER.md'))
    }
    const child = spawn(PYTHON, ['-m', 'identify.cli', ...args], { cwd: ROOT })
    let out = '', err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Reading the photo took too long'))
    }, timeout)

    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(out.trim().split('\n').pop() || '{}')
        if (parsed.error) return reject(new Error(parsed.error))
        resolve(parsed)
      } catch {
        reject(new Error(err.trim().split('\n').pop() || 'The photo reader returned nothing'))
      }
    })
  })
}

/** Read a photograph of the back of a sleeve. Returns candidates, not answers. */
export function readBackCover(imagePath) {
  return runPython(['backcover', '--image', imagePath])
}

/** Match a photograph against the sleeves already in the collection. */
export function matchSleeve(imagePath, indexPath) {
  return runPython(['identify', '--image', imagePath, '--index', indexPath])
}

/**
 * Characters that look alike, grouped so each maps to one representative.
 *
 * Only *shapes* belong here. Which matters more than it sounds: catalogue numbers
 * run in sequence within a label, so K 50012 and K 50014 are two different Led
 * Zeppelin records sitting next to each other in Atlantic's numbering. A general
 * edit distance happily calls those a match and reports you already own a record
 * you don't. A misread turns 0 into O, never 2 into 4.
 */
const LOOKALIKE = ['O0QD', 'IL1', 'S5', 'B8', 'Z2', 'G6', 'EF', 'UV', 'T7']
const CONFUSABLE = Object.fromEntries(
  LOOKALIKE.flatMap((group) => [...group].map((c) => [c, group[0]])),
)

/** Strip a catalogue number to just its letters and digits. */
export function normaliseCatno(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Collapse the characters OCR confuses with each other.
 *
 * At a readable resolution tesseract's mistakes are shape confusions rather than
 * noise — MOSH079FDR comes back as MOSHO79FDR — so a catalogue number should be
 * compared with those pairs treated as equal rather than demanding a clean read.
 */
export function fuzzyCatno(value) {
  return normaliseCatno(value)
    .split('')
    .map((c) => CONFUSABLE[c] || c)
    .join('')
}

/**
 * Where `shorter` is `longer` with exactly one character missing, that character's
 * index in `longer`. Null when they differ any other way.
 */
function droppedCharacterIndex(shorter, longer) {
  if (longer.length - shorter.length !== 1) return null
  let i = 0
  while (i < shorter.length && shorter[i] === longer[i]) i++
  return shorter.slice(i) === longer.slice(i + 1) ? i : null
}

/**
 * Score how well an OCR'd string matches a known catalogue number, or null when
 * they are not the same number.
 *
 * The only differences forgiven are the ones OCR actually produces: characters
 * that look alike, and a single dropped glyph (V2027 came back as 2027). Anything
 * else is treated as a different record, because for catalogue numbers it is.
 */
export function catnoSimilarity(read, known) {
  const a = normaliseCatno(read)
  const b = normaliseCatno(known)
  if (!a || !b) return null
  if (a === b) return 1

  const fa = fuzzyCatno(a)
  const fb = fuzzyCatno(b)
  if (fa === fb) return 0.9

  // OCR does drop a character, most often a letter that has run into the edge of
  // the sleeve — V2027 came back as 2027. Losing a *digit* is a different matter:
  // it turns one real catalogue number into another real one, so K 50014 read as
  // K 5014 has to stay a miss rather than become a confident wrong answer.
  const shorterIsA = fa.length < fb.length
  const [shorter, longer] = shorterIsA ? [fa, fb] : [fb, fa]
  const index = droppedCharacterIndex(shorter, longer)
  if (index !== null) {
    const original = shorterIsA ? b : a
    if (/[A-Z]/.test(normaliseCatno(original)[index] || '')) return 0.7
  }
  return null
}
