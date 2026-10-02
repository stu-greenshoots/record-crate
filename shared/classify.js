/**
 * Shelf auto-classification and "file it under" sort-name derivation.
 *
 * Sort names follow library practice: leading articles move to the end, and people
 * are filed under surname. Working out whether an artist is a person or a group is
 * the hard part, so it happens in three passes of increasing confidence:
 *
 *   1. a name-shape heuristic, available instantly for every record
 *   2. Discogs' own artist resource (a `members` list means group, a `realname`
 *      means person), filled in by the background enrichment crawl
 *   3. an explicit user override, which always wins
 */

const ARTICLES = new Set(['the', 'a', 'an', 'los', 'las', 'les', 'la', 'le', 'el', 'die', 'der', 'das'])

/** Name particles that belong with the surname: "Ludwig van Beethoven" -> "Beethoven, Ludwig van". */
const PARTICLES = new Set([
  'van', 'von', 'de', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'ten', 'ter',
  'den', 'der', 'bin', 'ibn', 'al', 'st', 'st.', 'mac', 'af', 'av',
])

/** Words that give away an ensemble rather than a person. */
const GROUP_MARKERS = new Set([
  'band', 'orchestra', 'ensemble', 'quartet', 'quintet', 'trio', 'sextet', 'septet',
  'octet', 'choir', 'chorus', 'symphony', 'philharmonic', 'players', 'brothers',
  'sisters', 'family', 'crew', 'boys', 'girls', 'group', 'project', 'collective',
  'orchestre', 'allstars', 'all-stars', 'experience', 'machine', 'club', 'society',
  'gang', 'company', 'union', 'brigade', 'squad', 'sound', 'system', 'soundsystem',
  'records', 'inc', 'ltd', 'featuring', 'presents', 'orchestra.', 'singers',
])

const DISAMBIGUATOR = /\s*\(\d+\)\s*$/

/** Han, Hiragana, Katakana and Hangul — scripts that write the family name first. */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/

export function cleanArtistName(name) {
  return String(name || '').replace(DISAMBIGUATOR, '').trim()
}

/** Stable key for grouping records by artist, tolerant of case and the "(2)" suffix. */
export function artistKey(name) {
  return cleanArtistName(name).toLowerCase()
}

function titleCaseWord(w) {
  return /^[A-ZÀ-Þ][a-zà-ÿ'’.\-]*$/.test(w)
}

/**
 * Guess whether a name is a person from its shape alone.
 * @returns {'person'|'group'|'mononym'}
 */
function guessArtistType(name) {
  const raw = cleanArtistName(name)
  if (!raw) return 'group'

  const words = raw.split(/\s+/)
  const lowered = raw.toLowerCase()

  // A leading article is a very strong signal of a band name.
  if (ARTICLES.has(words[0].toLowerCase())) return 'group'
  if (/[&+/]|\b(and|with|meets|vs\.?|featuring|feat\.?)\b/i.test(raw)) return 'group'
  if (/\d/.test(raw)) return 'group'
  if (words.some((w) => GROUP_MARKERS.has(w.toLowerCase().replace(/[^a-z.\-]/g, '')))) return 'group'
  // Shouty names (SOPHIE, ABBA, MF DOOM) read as acts, not people.
  if (raw === raw.toUpperCase() && raw.length > 1) return 'group'

  if (words.length === 1) return 'mononym'
  if (words.length > 3) return 'group'

  const shaped = words.every((w) => titleCaseWord(w) || PARTICLES.has(w.toLowerCase()))
  if (!shaped) return 'group'
  if (words.length === 2) return 'person'

  // Three words are only a person when the middle one is a particle or an initial
  // ("Ludwig van Beethoven", "John F. Kennedy"). Otherwise it reads as an act —
  // "Sun Ra Arkestra", "Dirty Three Trio".
  const middle = words[1]
  return PARTICLES.has(middle.toLowerCase()) || /^[A-Z]\.?$/.test(middle) ? 'person' : 'group'
}

/**
 * Derive the string a record files under.
 * @param {string} name raw Discogs artist name
 * @param {{type?: string}|null} artistInfo cached Discogs artist resource summary
 * @param {string|null} override explicit user-set sort name
 * @returns {{sortName: string, basis: 'override'|'discogs'|'guess'|'plain', type: string}}
 */
export function deriveSortName(name, artistInfo = null, override = null) {
  const clean = cleanArtistName(name)
  if (override) return { sortName: override, basis: 'override', type: 'override' }
  if (!clean) return { sortName: '', basis: 'plain', type: 'group' }

  if (/^various(\s+artists)?$/i.test(clean)) {
    return { sortName: 'Various Artists', basis: 'plain', type: 'group' }
  }

  const known = artistInfo && artistInfo.type
  const type = known || guessArtistType(clean)
  const basis = known ? 'discogs' : type === 'mononym' ? 'plain' : 'guess'

  const words = clean.split(/\s+/)

  // CJK names are already written family-name-first, so the Western "Last, First"
  // swap turns 久石 譲 into 譲, 久石 — filing Joe Hisaishi under the wrong character.
  if (CJK.test(clean)) return { sortName: clean, basis, type }

  if (type === 'person') {
    // Library convention: file under the surname, with any particles trailing the
    // forenames — "Ludwig van Beethoven" files as "Beethoven, Ludwig van".
    const surname = words[words.length - 1]
    let i = words.length - 1
    const particles = []
    while (i > 1 && PARTICLES.has(words[i - 1].toLowerCase())) {
      particles.unshift(words[i - 1])
      i -= 1
    }
    const forenames = words.slice(0, i)
    const trailing = [...forenames, ...particles].join(' ')
    return { sortName: trailing ? `${surname}, ${trailing}` : surname, basis, type }
  }

  if (ARTICLES.has(words[0].toLowerCase()) && words.length > 1) {
    return { sortName: `${words.slice(1).join(' ')}, ${words[0]}`, basis, type: 'group' }
  }

  return { sortName: clean, basis, type }
}

/** Comparison key: accent-folded, punctuation-stripped, uppercase. */
export function collationKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .toUpperCase()
}

/* ------------------------------------------------------------------ */
/* Shelf classification                                                */
/* ------------------------------------------------------------------ */

const METAL_EXTRA = new Set([
  'thrash', 'grindcore', 'deathcore', 'metalcore', 'nwobhm', 'death metal',
  'black metal', 'doom metal', 'speed metal', 'power metal', 'sludge metal',
  'grindcore', 'crust', 'djent',
])

const SCREEN_STYLES = ['soundtrack', 'score', 'theme', 'video game music', 'musical']
const SCREEN_TITLE = /\b(original\s+(motion\s+picture\s+)?(soundtrack|score)|soundtrack|\bo\.?s\.?t\.?\b|video\s*game|game\s+soundtrack)\b/i

function lowerList(xs) {
  return (xs || []).map((x) => String(x).toLowerCase())
}

function formatDescriptions(info) {
  const out = []
  for (const f of info.formats || []) {
    out.push(...lowerList(f.descriptions))
    if (f.name) out.push(String(f.name).toLowerCase())
    if (f.text) out.push(String(f.text).toLowerCase())
  }
  return out
}

/**
 * Pick a shelf for a freshly-imported record. Deliberately ordered most-specific
 * first: a metal 7" belongs with the singles, a soundtrack comp with the screen music.
 */
export function classifyShelf(info) {
  const styles = lowerList(info.styles)
  const genres = lowerList(info.genres)
  const descs = formatDescriptions(info)
  const title = String(info.title || '')
  const artist = String(info.artist || '')

  const isSingle =
    descs.includes('single') ||
    descs.includes('maxi-single') ||
    descs.some((d) => d === '7"' || d === '7' || d === '45 rpm, single')
  if (isSingle) return 'singles'

  const isScreen =
    genres.includes('stage & screen') ||
    styles.some((s) => SCREEN_STYLES.includes(s)) ||
    SCREEN_TITLE.test(title)
  if (isScreen) return 'screen'

  const isComp = descs.includes('compilation') || /^various(\s+artists)?$/i.test(artist)
  if (isComp) return 'comps'

  const isMetal =
    styles.some((s) => s.includes('metal') || METAL_EXTRA.has(s)) ||
    genres.some((g) => g.includes('metal'))
  if (isMetal) return 'metal'

  return 'main'
}
