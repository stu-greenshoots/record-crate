/**
 * Run the pressing-identification pipeline end to end against real photo files.
 *
 *   node scripts/smoke-identify.mjs runout=deadwax.jpg back=sleeve-back.jpg
 *   node scripts/smoke-identify.mjs runout=deadwax.jpg search="beatles abbey road"
 *   node scripts/smoke-identify.mjs runout=deadwax.jpg --compare
 *
 * --compare skips the server entirely: it runs the runout photo against every
 * vision backend that has a key configured (claude, gemini, openai, grok) and
 * prints their readings side by side, so you can eyeball which model reads
 * real deadwax best. Backends without a key are listed as skipped.
 *
 * Photo arguments are type=path pairs (types: front, back, label, runout);
 * search= adds a fallback search hint. Needs the server running — npm run server —
 * because the Discogs lookup goes through its auth and rate limiting. Runout
 * extraction needs ANTHROPIC_API_KEY set (in .env or the environment — see
 * .env.example): the deadwax reader calls Claude vision.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SERVER = process.env.CRATE_SERVER || 'http://localhost:3000'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const photos = []
const files = {}
let search = null
let compare = false
for (const arg of process.argv.slice(2)) {
  if (arg === '--compare') {
    compare = true
    continue
  }
  const [key, ...rest] = arg.split('=')
  const value = rest.join('=')
  if (key === 'search') search = value
  else if (['front', 'back', 'label', 'runout'].includes(key)) {
    if (!fs.existsSync(value)) {
      console.error(`No such file: ${value}`)
      process.exit(1)
    }
    photos.push({ type: key, data: fs.readFileSync(value).toString('base64') })
    files[key] = value
  } else {
    console.error(`Unknown argument "${key}" — use front=, back=, label=, runout= or search=`)
    process.exit(1)
  }
}

if (!photos.length) {
  console.error('Give at least one photo, e.g. runout=deadwax.jpg')
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* Compare mode: one deadwax photo, every configured vision backend.   */
/* ------------------------------------------------------------------ */

function envSetting(...names) {
  for (const name of names) if (process.env[name]) return process.env[name]
  const envFile = path.join(ROOT, '.env')
  if (!fs.existsSync(envFile)) return null
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  for (const name of names) {
    const line = lines.find((l) => l.trim().startsWith(`${name}=`))
    const value = line?.trim().slice(name.length + 1).trim()
    if (value) return value
  }
  return null
}

const BACKEND_KEYS = {
  claude: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  grok: ['XAI_API_KEY'],
}

if (compare) {
  if (!files.runout) {
    console.error('--compare needs a runout photo, e.g. runout=deadwax.jpg --compare')
    process.exit(1)
  }
  for (const [backend, keys] of Object.entries(BACKEND_KEYS)) {
    console.log(`\n═══ ${backend} ═══`)
    if (!envSetting(...keys)) {
      console.log(`  SKIPPED (no key — set ${keys.join(' or ')})`)
      continue
    }
    const started = Date.now()
    const run = spawnSync(
      path.join(ROOT, '.venv', 'bin', 'python'),
      ['-m', 'identify.cli', 'runout', '--image', files.runout, '--backend', backend],
      { cwd: ROOT, encoding: 'utf8', timeout: 180_000 },
    )
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    let body
    try {
      body = JSON.parse(run.stdout.trim().split('\n').pop() || '{}')
    } catch {
      console.log(`  FAILED after ${elapsed}s: ${run.stderr.trim().split('\n').pop() || 'no output'}`)
      continue
    }
    if (body.error) {
      console.log(`  ERROR after ${elapsed}s: ${body.error}`)
      continue
    }
    console.log(`  model:      ${body.model_used}   (${elapsed}s)`)
    console.log(`  side A:     ${body.candidates?.find((c) => c.side === 'A')?.value ?? '—'}`)
    console.log(`  side B:     ${body.candidates?.find((c) => c.side === 'B')?.value ?? '—'}`)
    console.log(`  confidence: ${body.confidence}`)
    console.log(`  raw text:   ${(body.raw_text || '—').replaceAll('\n', ' / ')}`)
    if (body.notes) console.log(`  notes:      ${body.notes}`)
    if (body.usage) console.log(`  tokens:     ${body.usage.input_tokens} in / ${body.usage.output_tokens} out`)
  }
  console.log()
  process.exit(0)
}

const res = await fetch(`${SERVER}/api/identify/pressing`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ photos, hints: search ? { search } : undefined }),
})
const body = await res.json()

if (!res.ok) {
  console.error(`Server said ${res.status}: ${body.error || 'no detail'}`)
  process.exit(1)
}

for (const read of body.reads || []) {
  console.log(`\n— ${read.type} photo —`)
  if (read.type === 'runout') {
    for (const c of read.candidates || []) {
      console.log(`  ${String(c.confidence).padEnd(5)} ${c.value}   (${(c.variants || []).length} variants agree)`)
    }
    if (!(read.candidates || []).length) console.log('  nothing readable in the deadwax')
  } else {
    console.log(`  catalogue numbers: ${(read.catalogueNumbers || []).map((c) => c.value).join(', ') || 'none'}`)
    console.log(`  search terms: ${read.searchTerms || 'none'}`)
  }
}

console.log(`\nConfidence basis: ${body.confidence}`)
console.log('Candidates:')
for (const c of body.candidates || []) {
  const parts = [`#${c.releaseId}`, c.title, c.year, c.country, c.catno].filter(Boolean)
  console.log(`  ${String(c.score).padEnd(5)} ${parts.join(' · ')}`)
  if (c.matched?.runout) console.log(`        runout: "${c.matched.runout.read}" ≈ "${c.matched.runout.known}"`)
  for (const hint of c.distinguishers || []) console.log(`        ${hint}`)
}
if (!(body.candidates || []).length) console.log(`  none — ${body.error || ''}`)
