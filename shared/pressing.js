/**
 * What's known about one pressing, from its Discogs release and the other vinyl
 * versions of the same album: whether it's the original, who cut it, where it was
 * pressed, and the odd details collectors look for.
 *
 * Discogs describes releases, not copies. Where an original came out in several
 * variants (plants, labels, runouts) the verdict says so, and the runouts are how to
 * tell which one you've got.
 */

const yearOf = (s) => {
  const m = String(s ?? '').match(/\b(1[89]\d\d|20\d\d)\b/)
  return m ? Number(m[1]) : null
}

function words(release) {
  return (release.formats || []).flatMap((f) => [...(f.descriptions || []), f.text || '']).join(' | ')
}

const catnos = (s) =>
  String(s || '')
    .split(',')
    .map((c) => c.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean)

/**
 * The verdict on a release among its album's vinyl versions (oldest first, as
 * fetched), given the album's original year and Discogs' main release for it, which
 * their guidelines make the original issue.
 *
 *   kind: first | same-year | first-local | first-vinyl | reissue | repress | unofficial | unknown
 *
 * A first pressing is the main release, or one with its country, catalogue number and
 * year that isn't marked a repress: Discogs often splits a first pressing into
 * variants (plants, label misprints) that collectors still call first pressings.
 */
export function verdict(release, versions = [], albumYear = null, mainId = null) {
  const said = words(release)
  const year = release.year || yearOf(release.released)
  const country = release.country || null
  const dated = versions.map((v) => ({ ...v, year: yearOf(v.released) })).filter((v) => v.year)
  const years = [...dated.map((v) => v.year), albumYear].filter(Boolean)
  const firstYear = years.length ? Math.min(...years) : null
  const main = mainId ? versions.find((v) => v.id === mainId) || null : null
  // Without a main release, only a full date says which country came first: most
  // versions give just a year.
  const exact = dated.filter((v) => /^\d{4}-\d\d-\d\d$/.test(v.released) && !v.released.endsWith('-00'))
  const earliest = exact.length ? exact.reduce((a, b) => (b.released < a.released ? b : a)) : null
  const origin = main?.country || (earliest && earliest.year === firstYear ? earliest.country : null)
  const promo = /\bPromo\b/.test(said)
  const base = { firstYear, origin, promo, versions: versions.length }

  if (/Unofficial Release/.test(said)) return { ...base, kind: 'unofficial', text: 'Unofficial release' }
  if (!year) return { ...base, kind: 'unknown', text: "Discogs doesn't know when this was pressed" }

  const reissued = /\bReissue\b/.test(said)
  const repressed = /\bRepress\b/.test(said)
  const fresh = !reissued && !repressed
  const vinylBefore = dated.some((v) => v.year < year)
  const sameCountryBefore = dated.some((v) => v.country === country && v.year < year)
  const mine = (release.labels || []).flatMap((l) => catnos(l.catno))
  const mainYear = main ? yearOf(main.released) : null
  const sameIssue =
    main && fresh && country === main.country && year === mainYear && catnos(main.catno).some((c) => mine.includes(c))
  const variants = main
    ? dated.filter((v) => v.country === main.country && v.year === mainYear && catnos(v.catno).some((c) => catnos(main.catno).includes(c))).length
    : 0
  const issue = main ? `${main.country}, ${main.catno.split(',')[0].trim()}, ${mainYear}` : ''

  // The main release may not be vinyl (a cassette or CD original), so check it by id.
  if ((mainId && release.id === mainId) || sameIssue) {
    const notes = []
    if (release.id !== mainId && issue) notes.push(`Same country, catalogue number and year as the first issue (${issue}).`)
    if (variants > 1) notes.push(`Discogs lists ${variants} variants of it; the run-outs and label details tell the earliest.`)
    const medium0 = release.formats?.[0]?.name
    const text = !medium0 || medium0 === 'Vinyl' ? 'First pressing' : `Original ${medium0 === 'CD' ? 'CD' : medium0.toLowerCase()}`
    return { ...base, kind: 'first', text, detail: notes.join(' ') || null }
  }
  // An album with no other versions on Discogs: this is the one.
  if (!versions.length && fresh && (!albumYear || albumYear === year)) {
    return { ...base, kind: 'first', text: 'First pressing', detail: null }
  }
  // The main release isn't vinyl (a CD-era album): the earliest vinyl is its first pressing.
  if (fresh && mainId && !main && dated.length && !vinylBefore && (!albumYear || albumYear === year)) {
    const alongside = dated.filter((v) => v.year === year).length
    return {
      ...base,
      kind: 'first-vinyl',
      text: 'First vinyl pressing',
      detail: `The album's main issue on Discogs isn't vinyl; this is from the first year it was pressed on vinyl${alongside > 1 ? `, one of ${alongside} that year` : ''}.`,
    }
  }
  if (fresh && dated.length && !vinylBefore && albumYear && albumYear < year) {
    return {
      ...base,
      kind: 'first-vinyl',
      text: 'First vinyl pressing',
      detail: `The album came out in ${albumYear}; this was its first time on vinyl.`,
    }
  }
  if (fresh && country && country !== origin && !sameCountryBefore && firstYear && year === firstYear + 1) {
    return {
      ...base,
      kind: 'first-local',
      text: `First ${country} pressing`,
      detail: `A year after the album first came out${origin ? ` in ${origin}` : ''} (${firstYear}).`,
    }
  }
  const firstOut = firstYear ? `The album first came out in ${firstYear}${origin ? ` (${origin})` : ''}.` : null
  if (repressed && !reissued) {
    return { ...base, kind: 'repress', text: `${year} repress`, detail: firstYear && year > firstYear ? firstOut : null }
  }
  if (reissued || (firstYear && year > firstYear)) {
    return { ...base, kind: 'reissue', text: firstYear && year > firstYear ? `${year} reissue` : 'Reissue', detail: firstOut }
  }

  // From the first year, but not the first issue.
  const medium = release.formats?.[0]?.name
  const noun = !medium || medium === 'Vinyl' ? 'pressing' : medium === 'CD' ? 'CD' : medium.toLowerCase()
  return {
    ...base,
    kind: 'same-year',
    text: `${year} ${country ? `${country} ` : ''}${noun}`,
    detail: main
      ? country === main.country
        ? `The same year as the first issue (${issue}), but not the same catalogue number.`
        : `The same year as the first issue (${issue}).`
      : `From the album's first year${origin && origin !== country ? `; the first release was in ${origin}` : ''}. Discogs doesn't say which pressing came first.`,
  }
}

/** Mastering and cutting marks that turn up scratched into run-out grooves. */
const MARKS = [
  [/\bporky\b|prime cut/i, 'Porky Prime Cut: George Peckham cut the lacquer'],
  [/\bpecko\b/i, 'Pecko: George Peckham cut the lacquer'],
  [/\bsterling\b/i, 'Sterling Sound, New York'],
  [/masterdisk/i, 'Masterdisk, New York'],
  [/\bTML\b/, 'The Mastering Lab, Los Angeles'],
  [/\bbilbo\b/i, 'Bilbo: Denis Blackham cut the lacquer'],
  [/\barun\b/i, 'Arun Chakraverty cut the lacquer'],
  [/townhouse/i, 'Cut at Townhouse, London'],
  [/strawberry/i, 'Cut at Strawberry, London'],
  [/\bRL\b/, 'RL: probably Bob Ludwig'],
]

/** Who cut and mastered it: from the credits, the company list and the runouts. */
export function cutters(release) {
  const out = []
  const add = (text) => out.includes(text) || out.push(text)
  for (const c of release.credits || []) {
    if (/Lacquer Cut By/.test(c.role)) add(`Lacquer cut by ${c.name.replace(/\s+\(\d+\)$/, '')}`)
    if (/Mastered By/.test(c.role)) add(`Mastered by ${c.name.replace(/\s+\(\d+\)$/, '')}`)
  }
  for (const c of release.companies || []) {
    if (/Lacquer Cut At|Mastered At/.test(c.role)) add(`${c.role.replace(/ At$/, ' at')} ${c.name}`)
  }
  for (const i of release.identifiers || []) {
    if (!/Matrix/.test(i.type)) continue
    for (const [re, text] of MARKS) if (re.test(i.value)) add(text)
  }
  return out
}

/** The run-out etchings, grouped by variant where Discogs lists more than one. */
export function runouts(release) {
  const lines = (release.identifiers || []).filter((i) => /Matrix/.test(i.type))
  const variants = new Map()
  for (const i of lines) {
    const v = i.description?.match(/\(Variant (\d+)\)/)?.[1] || ''
    const side = (i.description || '').replace(/\(Variant \d+\)\s*/, '').trim()
    if (!variants.has(v)) variants.set(v, [])
    variants.get(v).push({ value: i.value, side })
  }
  return [...variants].map(([variant, sides]) => ({ variant: variant ? Number(variant) : null, sides }))
}

/** Where it was pressed and the physical details worth knowing. */
export function physical(release) {
  const facts = []
  const plant = (release.companies || []).find((c) => /Pressed By/.test(c.role))
  if (plant) facts.push(`Pressed by ${plant.name}`)
  const made = (release.companies || []).find((c) => /Made By|Manufactured By/.test(c.role))
  if (made && !plant) facts.push(`Made by ${made.name}`)
  for (const f of release.formats || []) {
    const d = f.descriptions || []
    if (Number(f.qty) > 1) facts.push(`${f.qty} discs`)
    for (const k of ['Mono', 'Quadraphonic', 'Gatefold', 'Limited Edition', 'Numbered', 'Club Edition', 'Promo', 'Test Pressing', 'Picture Disc', 'Misprint', 'Remastered']) {
      if (d.includes(k)) facts.push(k)
    }
    if (f.text) facts.push(f.text)
  }
  return [...new Set(facts)]
}

/**
 * Discogs notes with their markup turned into pieces to render: plain text, and
 * links to other Discogs pages. [r123] is a release, [m123] a master, [a=Name] or
 * [a123] an artist, [l=Name] a label, [url=...]text[/url] a link.
 */
export function noteParts(notes) {
  if (!notes) return []
  const parts = []
  const re = /\[(r|m|a|l)=?([^\]]+)\]|\[url=([^\]]+)\]([^[]*)\[\/url\]|\[\/?[biu]\]/gi
  let at = 0
  for (const m of notes.matchAll(re)) {
    if (m.index > at) parts.push({ text: notes.slice(at, m.index) })
    if (m[1]) {
      const kind = m[1].toLowerCase()
      const value = m[2]
      const path = { r: 'release', m: 'master', a: 'artist', l: 'label' }[kind]
      if (/^\d+$/.test(value)) {
        parts.push({ text: { r: 'this release', m: 'this album', a: 'this artist', l: 'this label' }[kind].replace('this', 'another'), href: `https://www.discogs.com/${path}/${value}` })
      } else {
        parts.push({ text: value, href: `https://www.discogs.com/search/?q=${encodeURIComponent(value)}&type=${path}` })
      }
    } else if (m[3]) {
      parts.push({ text: m[4] || m[3], href: m[3] })
    }
    at = m.index + m[0].length
  }
  if (at < notes.length) parts.push({ text: notes.slice(at) })
  return parts
}
