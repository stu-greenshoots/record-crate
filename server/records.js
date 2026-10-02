import { store } from './store.js'
import { deriveSortName, artistKey, collationKey, cleanArtistName } from './classify.js'
import { shelfWidth, shelfHeight } from './thickness.js'

function primaryArtist(item) {
  const list = item.info.artists || []
  return list.find((a) => a.id && a.id !== 194) || list[0] || null
}

function formatLine(info) {
  return (info.formats || [])
    .map((f) => {
      const bits = [f.name]
      if (f.qty && Number(f.qty) > 1) bits.unshift(`${f.qty}×`)
      const extra = [...(f.descriptions || []), f.text].filter(Boolean)
      return extra.length ? `${bits.join('')} · ${extra.join(', ')}` : bits.join('')
    })
    .join(' + ')
}

/**
 * The most useful single word for a card: "LP", "7\"", "Maxi-Single" — the media
 * name ("Vinyl") is the least informative part, so it's only the fallback.
 */
function formatShort(info) {
  const formats = info.formats || []
  // A box set is what the thing is, whatever medium sits inside it.
  if (formats.some((f) => /box\s*set/i.test(f.name || '') ||
      (f.descriptions || []).some((d) => /box\s*set/i.test(d)))) {
    const discs = formats.reduce((a, f) => a + (Number(f.qty) || 0), 0)
    return discs > 1 ? `${discs}× Box Set` : 'Box Set'
  }
  const first = formats[0]
  if (!first) return ''
  const descs = first.descriptions || []
  const core =
    descs.find((d) =>
      /^(\d+\s*[×x]\s*)?(LP|EP|\d+"|Album|Single|Maxi-Single|Compilation|Mini-Album)$/i.test(d),
    ) ||
    descs[0] ||
    first.name ||
    ''
  const qty = Number(first.qty)
  return qty > 1 && !/[×x]/.test(core) ? `${qty}×${core}` : core
}

function coverArt(item) {
  const detail = store.getRelease(item.releaseId)
  const master = item.masterId ? store.getMaster(item.masterId) : null
  const images = (detail && detail.images) || []
  const front = images.find((i) => i.type === 'primary') || images[0] || null
  const back = images.find((i, idx) => i.type === 'secondary' && idx > 0) || images[1] || null
  return {
    front: front?.uri || item.info.cover || item.info.thumb || '',
    back: back?.uri || null,
    imageCount: images.length,
    hasDetail: Boolean(detail && !detail.missing),
  }
}

/** Flatten a stored collection item into the shape the UI renders. */
export function buildRecord(item) {
  const info = item.info
  const artist = primaryArtist(item)
  const artistInfo = artist && artist.id ? store.getArtist(artist.id) : null

  /**
   * File under the artist's canonical Discogs name, never the credit printed on
   * this particular sleeve. Discogs gives one artist entity a name plus per-release
   * "name variations" (anv) — Joe Hisaishi is credited 久石 譲 on two of his
   * soundtracks, Bowie as both "Bowie" and "David Bowie". Filing by the variation
   * scatters a single artist across the shelf in two places.
   */
  const rawName = cleanArtistName(artistInfo?.name || (artist ? artist.name : info.artist))
  // Key on the Discogs artist id where there is one, so a sort-name override
  // follows the artist rather than one spelling of their name.
  const nameKey = artistKey(rawName)
  const key = artist?.id ? `id:${artist.id}` : nameKey
  const override =
    store.overrides.artists[key]?.sortName || store.overrides.artists[nameKey]?.sortName || null
  const { sortName, basis, type } = deriveSortName(rawName, artistInfo, override)
  const record = store.overrides.records[String(item.instanceId)] || { shelf: 'main', position: null }
  const art = coverArt(item)
  const market = store.getMarket(item.releaseId)
  const detail = store.getRelease(item.releaseId)
  const master = item.masterId ? store.getMaster(item.masterId) : null

  return {
    instanceId: item.instanceId,
    releaseId: item.releaseId,
    masterId: item.masterId,
    title: info.title,
    artist: info.artist || rawName,
    artistName: rawName,
    artistId: artist?.id || null,
    artistKey: key,
    sortName,
    sortBasis: basis,
    artistType: type,
    year: info.year || null,
    // The year the album first came out, where Discogs' master release knows it —
    // your copy may be a much later pressing.
    originalYear: master?.year || info.year || null,
    isReissue: Boolean(master?.year && info.year && master.year < info.year),
    addedAt: item.addedAt,
    rating: item.rating,
    genres: info.genres,
    styles: info.styles,
    labels: info.labels,
    catno: info.labels?.[0]?.catno || '',
    label: info.labels?.[0]?.name || '',
    formatLine: formatLine(info),
    formatShort: formatShort(info),
    isBox: (info.formats || []).some(
      (f) =>
        /box\s*set/i.test(f.name || '') ||
        (f.descriptions || []).some((d) => /box\s*set/i.test(d)),
    ),
    // Shelf space this copy eats, in standard-LP widths.
    width: shelfWidth(info, detail?.estimatedWeight ?? null),
    // Sleeve height relative to a 12" LP, so a 7" stands short on the shelf.
    height: shelfHeight(info),
    formatTags: [...new Set((info.formats || []).flatMap((f) => [f.name, ...(f.descriptions || [])]))],
    shelf: record.shelf,
    autoShelf: record.autoShelf || null,
    position: record.position,
    thumb: info.thumb,
    cover: art.front,
    back: art.back,
    imageCount: art.imageCount,
    hasDetail: art.hasDetail,
    lowestPrice: market?.stats?.lowest_price?.value ?? null,
    currency: market?.stats?.lowest_price?.currency ?? null,
    numForSale: market?.stats?.num_for_sale ?? null,
  }
}

export function allRecords() {
  return store.collection.items.map(buildRecord)
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export const SORT_MODES = {
  smart: {
    label: 'Filed (artist, then year)',
    compare: (a, b) =>
      cmp(collationKey(a.sortName), collationKey(b.sortName)) ||
      cmp(a.originalYear || 9999, b.originalYear || 9999) ||
      cmp(collationKey(a.title), collationKey(b.title)),
  },
  artist: {
    label: 'Artist as written',
    compare: (a, b) =>
      cmp(collationKey(a.artist), collationKey(b.artist)) ||
      cmp(a.originalYear || 9999, b.originalYear || 9999),
  },
  title: {
    label: 'Album title',
    compare: (a, b) => cmp(collationKey(a.title), collationKey(b.title)),
  },
  year: {
    label: 'Year first released',
    compare: (a, b) =>
      cmp(a.originalYear || 9999, b.originalYear || 9999) ||
      cmp(collationKey(a.sortName), collationKey(b.sortName)),
  },
  added: {
    label: 'Recently added',
    compare: (a, b) => cmp(b.addedAt || '', a.addedAt || ''),
  },
  value: {
    label: 'Market value',
    compare: (a, b) => cmp(b.lowestPrice ?? -1, a.lowestPrice ?? -1),
  },
  manual: {
    label: 'My own order',
    compare: (a, b) =>
      cmp(a.position ?? Number.MAX_SAFE_INTEGER, b.position ?? Number.MAX_SAFE_INTEGER) ||
      cmp(collationKey(a.sortName), collationKey(b.sortName)),
  },
}

export function sortRecords(records, mode) {
  const sorter = SORT_MODES[mode] || SORT_MODES.smart
  return [...records].sort(sorter.compare)
}
