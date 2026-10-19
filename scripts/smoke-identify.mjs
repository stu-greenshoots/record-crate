/**
 * Run the pressing-identification pipeline end to end against real photo files.
 *
 *   node scripts/smoke-identify.mjs runout=deadwax.jpg back=sleeve-back.jpg
 *   node scripts/smoke-identify.mjs runout=deadwax.jpg search="beatles abbey road"
 *
 * Photo arguments are type=path pairs (types: front, back, label, runout);
 * search= adds a fallback search hint. Needs the server running — npm run server —
 * because the Discogs lookup goes through its auth and rate limiting. Runout
 * extraction needs ANTHROPIC_API_KEY set (in .env or the environment — see
 * .env.example): the deadwax reader calls Claude vision.
 */

import fs from 'node:fs'

const SERVER = process.env.CRATE_SERVER || 'http://localhost:3000'

const photos = []
let search = null
for (const arg of process.argv.slice(2)) {
  const [key, ...rest] = arg.split('=')
  const value = rest.join('=')
  if (key === 'search') search = value
  else if (['front', 'back', 'label', 'runout'].includes(key)) {
    if (!fs.existsSync(value)) {
      console.error(`No such file: ${value}`)
      process.exit(1)
    }
    photos.push({ type: key, data: fs.readFileSync(value).toString('base64') })
  } else {
    console.error(`Unknown argument "${key}" — use front=, back=, label=, runout= or search=`)
    process.exit(1)
  }
}

if (!photos.length) {
  console.error('Give at least one photo, e.g. runout=deadwax.jpg')
  process.exit(1)
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
